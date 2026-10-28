import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export interface PrestageFile {
  name: string;
  bytes: number;
  sha256: string;
}
export interface PrestageDataset {
  directory: string;
  manifestName: "artifact-manifest.json" | "private-operational-manifest.json";
  manifestSha256: string;
  files: readonly PrestageFile[];
}
export interface ExistingStackBindings {
  outputs: Record<string, string>;
  resources: readonly {
    LogicalResourceId?: string;
    PhysicalResourceId?: string;
    ResourceType?: string;
  }[];
}
export function validatePrestageBindings(
  existing: ExistingStackBindings | undefined,
  needsPrivate: boolean,
) {
  if (
    !existing ||
    !existing.outputs ||
    existing.outputs.Region !== "us-east-1" ||
    existing.outputs.Stage !== "p3-review" ||
    !Array.isArray(existing.resources) ||
    existing.resources.length > 100
  )
    throw new Error(
      "Existing review stack required; first-create/bootstrap is a separate operation with no preactivated-data claim",
    );
  const result: { publicBucket: string; privateBucket?: string } = {
    publicBucket: existing.outputs.SnapshotBucket,
  };
  const bound = (bucket: string | undefined, logical: RegExp) =>
    typeof bucket === "string" &&
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) &&
    existing.resources.filter(
      (r) =>
        r.ResourceType === "AWS::S3::Bucket" &&
        logical.test(r.LogicalResourceId ?? "") &&
        r.PhysicalResourceId === bucket,
    ).length === 1;
  if (!bound(result.publicBucket, /^AcceptedSnapshots[A-F0-9]{8}$/))
    throw new Error("Existing task public bucket binding missing or invalid");
  if (needsPrivate) {
    result.privateBucket = existing.outputs.PrivateSnapshotBucket;
    if (
      !bound(
        result.privateBucket,
        /^ProtectedOperationalSnapshots[A-F0-9]{8}$/,
      ) ||
      result.privateBucket === result.publicBucket
    )
      throw new Error(
        "Existing task protected bucket binding missing or invalid; create/bootstrap separately before private activation",
      );
  }
  return result;
}
/** Sequential exact uploads, manifests last, completed before any runtime configuration activation. The injected CLI transport is the only remote effect. */
export async function prestageReviewedUpdate(input: {
  existing: ExistingStackBindings | undefined;
  expectedAccountId: string;
  snapshotId: string;
  public: PrestageDataset;
  protected?: PrestageDataset;
  command: (args: string[]) => Promise<unknown> | unknown;
}) {
  if (
    !/^\d{12}$/.test(input.expectedAccountId) ||
    !/^oakland-real-[a-f0-9]{20}$/.test(input.snapshotId)
  )
    throw new Error("Exact prestage account/snapshot identity required");
  const buckets = validatePrestageBindings(
    input.existing,
    Boolean(input.protected),
  );
  const planned: {
    scope: "public" | "protected";
    file: string;
    bucket: string;
    key: string;
    bytes: number;
    sha256: string;
    manifest: boolean;
  }[] = [];
  for (const [scope, data, bucket, prefix] of [
    [
      "public",
      input.public,
      buckets.publicBucket,
      `accepted/${input.snapshotId}/`,
    ],
    [
      "protected",
      input.protected,
      buckets.privateBucket,
      input.protected
        ? `operational/${input.snapshotId}/${input.protected.manifestSha256}/`
        : "",
    ],
  ] as const) {
    if (!data) continue;
    if (
      data.manifestName !==
      (scope === "public"
        ? "artifact-manifest.json"
        : "private-operational-manifest.json")
    )
      throw new Error("Prestage public/protected manifest role mismatch");
    if (
      !path.isAbsolute(data.directory) ||
      !bucket ||
      !/^[a-f0-9]{64}$/.test(data.manifestSha256) ||
      !Array.isArray(data.files) ||
      data.files.length < 1 ||
      data.files.length > 64
    )
      throw new Error("Prestage reviewed dataset rejected");
    const root = await lstat(data.directory);
    if (!root.isDirectory() || root.isSymbolicLink())
      throw new Error("Prestage directory link rejected");
    const manifestPath = path.join(data.directory, data.manifestName),
      manifestStat = await lstat(manifestPath);
    if (
      !manifestStat.isFile() ||
      manifestStat.isSymbolicLink() ||
      manifestStat.nlink !== 1 ||
      manifestStat.size > 1048576
    )
      throw new Error("Prestage manifest path/size rejected");
    const manifestBytes = await readFile(manifestPath),
      manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (
      createHash("sha256").update(manifestBytes).digest("hex") !==
        data.manifestSha256 ||
      manifest.snapshotId !== input.snapshotId ||
      JSON.stringify(manifest.files) !== JSON.stringify(data.files)
    )
      throw new Error("Prestage manifest checksum/snapshot/files mismatch");
    const seen = new Set<string>();
    let total = 0;
    for (const entry of [
      ...data.files,
      {
        name: data.manifestName,
        bytes: manifestBytes.length,
        sha256: data.manifestSha256,
      },
    ]) {
      if (
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(entry.name) ||
        seen.has(entry.name) ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 0 ||
        entry.bytes > 512 * 1024 ** 2 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      )
        throw new Error("Prestage file metadata rejected");
      seen.add(entry.name);
      total += entry.bytes;
      if (total > 1536 * 1024 ** 2)
        throw new Error("Prestage byte bound exceeded");
      const file = path.join(data.directory, entry.name),
        stat = await lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size !== entry.bytes ||
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex") !== entry.sha256
      )
        throw new Error("Prestage file checksum/path/size mismatch");
      planned.push({
        scope,
        file,
        bucket,
        key: prefix + entry.name,
        bytes: entry.bytes,
        sha256: entry.sha256,
        manifest: entry.name === data.manifestName,
      });
    }
  }
  // Finish every local check before the first upload. Publish all data objects before either manifest.
  planned.sort((a, b) => Number(a.manifest) - Number(b.manifest));
  for (const bucket of new Set(planned.map((x) => x.bucket))) {
    const response = await input.command([
      "s3api",
      "get-public-access-block",
      "--bucket",
      bucket,
      "--expected-bucket-owner",
      input.expectedAccountId,
      "--output",
      "json",
    ]);
    const block =
      response && typeof response === "object"
        ? (
            response as {
              PublicAccessBlockConfiguration?: Record<string, unknown>;
            }
          ).PublicAccessBlockConfiguration
        : undefined;
    if (
      !block ||
      Object.keys(block).length !== 4 ||
      ![
        "BlockPublicAcls",
        "IgnorePublicAcls",
        "BlockPublicPolicy",
        "RestrictPublicBuckets",
      ].every((k) => block[k] === true)
    )
      throw new Error(
        "Prestage task data bucket must block all public access before upload",
      );
  }
  const verified: {
    scope: string;
    name: string;
    bytes: number;
    sha256: string;
    serverChecksumVerified: true;
  }[] = [];
  for (const item of planned) {
    const checksum = Buffer.from(item.sha256, "hex").toString("base64"),
      response = await input.command([
        "s3api",
        "put-object",
        "--bucket",
        item.bucket,
        "--key",
        item.key,
        "--body",
        item.file,
        "--server-side-encryption",
        "AES256",
        "--checksum-algorithm",
        "SHA256",
        "--checksum-sha256",
        checksum,
        "--expected-bucket-owner",
        input.expectedAccountId,
        "--output",
        "json",
      ]);
    if (
      !response ||
      typeof response !== "object" ||
      (response as { ChecksumSHA256?: unknown }).ChecksumSHA256 !== checksum
    )
      throw new Error(
        "Prestage server checksum mismatch; runtime activation forbidden",
      );
    verified.push({
      scope: item.scope,
      name: path.basename(item.file),
      bytes: item.bytes,
      sha256: item.sha256,
      serverChecksumVerified: true,
    });
  }
  return {
    status: "all_exact_files_verified_before_activation" as const,
    privatePrefixContentAddressed: true,
    files: verified,
  };
}
