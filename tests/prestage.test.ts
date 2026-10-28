import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  prestageReviewedUpdate,
  validatePrestageBindings,
  type PrestageDataset,
} from "../packages/hosted-runtime/src/prestage.ts";
const sha = (data: Uint8Array | string) =>
    createHash("sha256").update(data).digest("hex"),
  sid = "oakland-real-" + "a".repeat(20),
  account = "123456789012";
const existing = {
  outputs: {
    Region: "us-east-2",
    Stage: "review",
    SnapshotBucket: "task-public-bucket",
    PrivateSnapshotBucket: "task-private-bucket",
  },
  resources: [
    {
      LogicalResourceId: "AcceptedSnapshots1234ABCD",
      ResourceType: "AWS::S3::Bucket",
      PhysicalResourceId: "task-public-bucket",
    },
    {
      LogicalResourceId: "ProtectedOperationalSnapshots5678ABCD",
      ResourceType: "AWS::S3::Bucket",
      PhysicalResourceId: "task-private-bucket",
    },
  ],
};
const block = {
  PublicAccessBlockConfiguration: {
    BlockPublicAcls: true,
    IgnorePublicAcls: true,
    BlockPublicPolicy: true,
    RestrictPublicBuckets: true,
  },
};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "prism-prestage-"));
  async function dataset(
    name: string,
    manifestName: PrestageDataset["manifestName"],
    file: string,
  ) {
    const directory = path.join(root, name);
    await mkdir(directory);
    const bytes = Buffer.from("synthetic-" + name),
      files = [{ name: file, bytes: bytes.length, sha256: sha(bytes) }],
      raw = JSON.stringify({ snapshotId: sid, files });
    await writeFile(path.join(directory, file), bytes);
    await writeFile(path.join(directory, manifestName), raw);
    return { directory, manifestName, manifestSha256: sha(raw), files };
  }
  return {
    root,
    public: await dataset(
      "public",
      "artifact-manifest.json",
      "parcels.parquet",
    ),
    protected: await dataset(
      "private",
      "private-operational-manifest.json",
      "protected-permits.parquet",
    ),
  };
}
it("all exact data objects and server checksums precede both manifests and activation under separate immutable prefixes", async () => {
  const f = await fixture(),
    events: string[] = [],
    keys: string[] = [];
  try {
    const proof = await prestageReviewedUpdate({
      existing,
      expectedAccountId: account,
      snapshotId: sid,
      public: f.public,
      protected: f.protected,
      command: (args) => {
        if (args[1] === "get-public-access-block") return block;
        expect(args).toContain("AES256");
        expect(args[args.indexOf("--expected-bucket-owner") + 1]).toBe(account);
        const file = args[args.indexOf("--body") + 1],
          key = args[args.indexOf("--key") + 1];
        events.push(path.basename(file));
        keys.push(key);
        return { ChecksumSHA256: args[args.indexOf("--checksum-sha256") + 1] };
      },
    });
    events.push("activate");
    expect(events).toEqual([
      "parcels.parquet",
      "protected-permits.parquet",
      "artifact-manifest.json",
      "private-operational-manifest.json",
      "activate",
    ]);
    expect(keys).toContain(
      `operational/${sid}/${f.protected.manifestSha256}/protected-permits.parquet`,
    );
    expect(keys).toContain(`accepted/${sid}/parcels.parquet`);
    expect(proof.files.every((x) => x.serverChecksumVerified)).toBe(true);
    expect(JSON.stringify(proof)).not.toContain(f.root);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("missing stack/private bucket or substituted resource fails before uploads and never claims first-create data readiness", async () => {
  for (const input of [
    undefined,
    {
      ...existing,
      outputs: { ...existing.outputs, PrivateSnapshotBucket: "" },
    },
    { ...existing, resources: existing.resources.slice(0, 1) },
    {
      ...existing,
      outputs: {
        ...existing.outputs,
        PrivateSnapshotBucket: existing.outputs.SnapshotBucket,
      },
    },
  ])
    expect(() => validatePrestageBindings(input, true)).toThrow();
  expect(() => validatePrestageBindings(undefined, false)).toThrow(
    "first-create/bootstrap",
  );
});
it("bad local file or server checksum aborts before any activation, and local preflight prevents even earlier valid data uploads", async () => {
  const f = await fixture();
  let writes = 0,
    activated = false;
  try {
    await writeFile(
      path.join(f.protected.directory, "protected-permits.parquet"),
      "bad",
    );
    await expect(
      prestageReviewedUpdate({
        existing,
        expectedAccountId: account,
        snapshotId: sid,
        public: f.public,
        protected: f.protected,
        command: () => {
          writes++;
          return {};
        },
      }),
    ).rejects.toThrow("checksum/path/size");
    expect(writes).toBe(0);
    await writeFile(
      path.join(f.protected.directory, "protected-permits.parquet"),
      "synthetic-private",
    );
    await expect(
      (async () => {
        await prestageReviewedUpdate({
          existing,
          expectedAccountId: account,
          snapshotId: sid,
          public: f.public,
          protected: f.protected,
          command: (args) =>
            args[1] === "get-public-access-block"
              ? block
              : (writes++, { ChecksumSHA256: "wrong" }),
        });
        activated = true;
      })(),
    ).rejects.toThrow("server checksum");
    expect(writes).toBe(1);
    expect(activated).toBe(false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("public access drift aborts before the first data upload", async () => {
  const f = await fixture();
  let writes = 0;
  try {
    await expect(
      prestageReviewedUpdate({
        existing,
        expectedAccountId: account,
        snapshotId: sid,
        public: f.public,
        command: (args) => {
          if (args[1] === "put-object") writes++;
          return {
            PublicAccessBlockConfiguration: {
              ...block.PublicAccessBlockConfiguration,
              RestrictPublicBuckets: false,
            },
          };
        },
      }),
    ).rejects.toThrow("block all public access");
    expect(writes).toBe(0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("actual deployment seam refuses unapproved first creation and preserves checksum-before-update ordering", async () => {
  const { reviewedDeployment } =
    await import("../packages/hosted-runtime/src/deploy-sequence.ts");
  const events: string[] = [];
  const effects = {
    prestage: async () => {
      events.push("checksum-verified");
      return { checked: true };
    },
    deploy: async () => {
      events.push("cdk-publish-deploy");
    },
    describeCreated: async () => {
      events.push("describe-created");
      return existing;
    },
  };
  await expect(
    reviewedDeployment({
      ...effects,
      existing: undefined,
      firstCreateApproved: false,
    }),
  ).rejects.toThrow("acknowledgment");
  expect(events).toEqual([]);
  const update = await reviewedDeployment({
    ...effects,
    existing,
    firstCreateApproved: false,
  });
  expect(events).toEqual(["checksum-verified", "cdk-publish-deploy"]);
  expect(update.activation).toBe("prestage_verified");
  events.length = 0;
  const created = await reviewedDeployment({
    ...effects,
    existing: undefined,
    firstCreateApproved: true,
  });
  expect(events).toEqual([
    "cdk-publish-deploy",
    "describe-created",
    "checksum-verified",
  ]);
  expect(created.activation).toBe("first_create_post_provision_verified");
  events.length = 0;
  await expect(
    reviewedDeployment({
      ...effects,
      existing,
      firstCreateApproved: true,
      prestage: async () => {
        throw new Error("wrong source/hash/rights");
      },
    }),
  ).rejects.toThrow("wrong source/hash/rights");
  expect(events).toEqual([]);
});
