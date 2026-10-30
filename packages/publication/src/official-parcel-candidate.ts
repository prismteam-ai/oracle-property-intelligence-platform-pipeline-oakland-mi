/** Local-only composition of immutable historical bytes and permitted official observations. */
import { createReadStream } from "node:fs";
import { lstat, readFile, mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { importer, type ImportResult } from "ipfs-unixfs-importer";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import { balanced } from "ipfs-unixfs-importer/layout";
import { exporter } from "ipfs-unixfs-exporter";
import { MemoryBlockstore } from "blockstore-core/memory";
import { CarWriter, CarReader } from "@ipld/car";
import { CID } from "multiformats/cid";
import { sha256 as multihash } from "multiformats/hashes/sha2";
import { sha256, stableJson } from "../../county/src/model.ts";
import {
  sourceFieldProfileDigest,
  eligiblePublicationFields,
} from "../../source-profiles/src/field-authority.ts";
import { z } from "zod";
import { validateSourceFieldProfile } from "../../source-profiles/src/field-authority.ts";
import { CONTRACT_VERSION } from "../../contracts/src/index.ts";
import { PUBLICATION_FILES, RUN_PUBLICATION_FILES } from "./local.ts";

type File = { name: string; bytes: number; sha256: string };

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const CountSchema = z.number().int().min(0).max(1_200_000);
const SnapshotSchema = z.string().regex(/^oakland-real-[a-f0-9]{20}$/);
const SourceUrlSchema = z.literal(
  "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1",
);
const TermsUrlSchema = z.literal(
  "https://www.oaklandcountymi.gov/government/open-data-agreement",
);
const RuleSchema = z
  .object({
    classification: z.enum([
      "official_public",
      "restricted_source",
      "credential",
    ]),
    exposed: z.boolean(),
    acquisitionAllowed: z.boolean(),
    runtimeAllowed: z.boolean(),
    publication: z.enum([
      "eligible_pending_human",
      "source_terms_restricted",
      "excluded",
    ]),
  })
  .strict();
const AvailabilitySchema = z
  .object({
    state: z.enum([
      "AVAILABLE",
      "EXPOSED_BUT_NULL_OR_EMPTY",
      "ACCESS_BLOCKED",
      "SOURCE_TERMS_RESTRICTED",
      "NOT_IN_SOURCE",
    ]),
    nonNullCount: CountSchema.nullable(),
    nonEmptyStringCount: CountSchema.nullable(),
  })
  .strict();
const ProfileSchema = z
  .object({
    version: z.literal("official-parcel-profile-v1"),
    publicSnapshotId: SnapshotSchema,
    sourceFileSha256: HashSchema,
    sourceSchemaSha256: HashSchema,
    sourceRecordCount: CountSchema.min(1),
    fieldClassificationDigest: HashSchema,
    profile: z
      .object({
        version: z.literal("source-field-authority-v1"),
        sourceId: z.literal("official-oakland-tax-parcel-full-attributes"),
        sourceUrl: SourceUrlSchema,
        sourceMetadataSha256: HashSchema,
        termsUrl: TermsUrlSchema,
        termsSha256: HashSchema,
        reviewedAt: z.iso.datetime({ offset: true }),
        fields: z
          .record(
            z
              .string()
              .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/),
            RuleSchema,
          )
          .refine(
            (v) => Object.keys(v).length > 0 && Object.keys(v).length <= 64,
          ),
      })
      .strict(),
    availability: z
      .object({
        receiptSha256: HashSchema,
        observedAt: z.iso.datetime({ offset: true }),
        currentParcelRows: CountSchema.min(1),
        retainedRowsAreNotCurrentCensus: z.literal(true),
        wholePopulationTrimmedNonEmptyCount: z.null(),
        fields: z
          .object({
            NAME1: AvailabilitySchema,
            NAME2: AvailabilitySchema,
            POSTALADDRESS: AvailabilitySchema,
            PHONE: AvailabilitySchema,
            EMAIL: AvailabilitySchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const field of Object.values(v.availability.fields))
      if (
        (field.nonNullCount !== null &&
          field.nonNullCount > v.availability.currentParcelRows) ||
        (field.nonEmptyStringCount !== null &&
          field.nonEmptyStringCount > v.availability.currentParcelRows) ||
        (field.nonNullCount !== null &&
          field.nonEmptyStringCount !== null &&
          field.nonEmptyStringCount > field.nonNullCount)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Current census availability counts must reconcile with its own population",
        });
  });
const ObservedCountSchema = z
  .object({
    present: CountSchema,
    populatedTrimmedString: CountSchema,
    observedNullOrEmpty: CountSchema,
    notObserved: CountSchema,
  })
  .strict();
const DecisionSchema = z
  .object({
    version: z.literal("official-parcel-publication-candidate-v1"),
    state: z.literal(
      "LOCAL_EXACT_BYTES_CANDIDATE_REQUIRES_HUMAN_APPROVAL_BEFORE_UPLOAD",
    ),
    uploadAuthorized: z.literal(false),
    publicSnapshotId: SnapshotSchema,
    retainedSourceFileSha256: HashSchema,
    sourceMetadataSha256: HashSchema,
    sourceTermsUrl: TermsUrlSchema,
    sourceTermsSha256: HashSchema,
    fieldClassificationDigest: HashSchema,
    rows: CountSchema.min(1),
    uniqueNativeIds: CountSchema.min(1),
    associatedProperties: CountSchema.min(1),
    fields: z
      .array(
        z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/),
      )
      .max(64),
    metadataEligibleFields: z
      .array(
        z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/),
      )
      .max(64),
    nameFieldsPreservedAsObserved: z.literal(true),
    populatedNameValues: z.number().int().min(0).max(2_400_000),
    observedFieldCounts: z
      .object({
        NAME1: ObservedCountSchema,
        NAME2: ObservedCountSchema,
        POSTALADDRESS: ObservedCountSchema,
      })
      .strict(),
    mailingAddressIncludedAsObserved: z.literal(true),
    providerRestrictedRowsIncluded: z.literal(false),
    observationsNotVerifiedLegalOwnership: z.literal(true),
    currentAvailabilityCensusDoesNotReplaceHistoricalData: z.literal(true),
    files: z
      .array(
        z
          .object({
            name: z.literal("official-parcel-observations.parquet"),
            bytes: z
              .number()
              .int()
              .min(1)
              .max(128 * 1024 ** 2),
            sha256: HashSchema,
          })
          .strict(),
      )
      .length(1),
    irreversiblePublicIpfsApproval: z.literal(
      "PENDING_EXACT_CANDIDATE_BYTES_AND_CAR_ROOT_HUMAN_DECISION",
    ),
    cidAndCar: z.literal(
      "Root combines these exact bytes with unchanged eligible base objects and computes the local CID/CAR; no upload performed by this exporter.",
    ),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const f of Object.values(v.observedFieldCounts))
      if (
        f.present + f.notObserved !== v.rows ||
        f.populatedTrimmedString + f.observedNullOrEmpty !== f.present
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Finite observed field counts must reconcile with retained rows",
        });
    if (
      v.uniqueNativeIds !== v.rows ||
      v.associatedProperties > v.rows ||
      v.populatedNameValues !==
        v.observedFieldCounts.NAME1.populatedTrimmedString +
          v.observedFieldCounts.NAME2.populatedTrimmedString ||
      new Set(v.fields).size !== v.fields.length ||
      new Set(v.metadataEligibleFields).size !== v.metadataEligibleFields.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Candidate identity, field or population counts inconsistent",
      });
  });

const OWNER_FILES = [
  "official-parcel-observations.parquet",
  "official-parcel-profile.json",
  "field-decision.json",
] as const;
const HASH = /^[a-f0-9]{64}$/;
async function bounded(file: string, max: number): Promise<Buffer> {
  const s = await lstat(file);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > max)
    throw new Error("Bounded regular candidate input required");
  return readFile(file);
}
async function digest(parts: AsyncIterable<Uint8Array>) {
  const h = createHash("sha256");
  let bytes = 0;
  for await (const p of parts) {
    bytes += p.length;
    h.update(p);
    if (bytes > 128 * 1024 ** 2)
      throw new Error("Candidate file verification bound");
  }
  return { bytes, sha256: h.digest("hex") };
}
async function all(parts: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) {
  const chunks = [];
  for await (const p of parts) chunks.push(p);
  return Buffer.concat(chunks);
}
/** Reject extra files/blocks, altered file bytes, and forged CID multihashes. */
export async function verifyOfficialCandidateCar(
  carFile: string,
  rootCid: string,
  files: readonly File[],
) {
  const car = await CarReader.fromIterable(createReadStream(carFile));
  const roots = await car.getRoots();
  if (roots.length !== 1 || roots[0]!.toString() !== rootCid)
    throw new Error("Candidate CAR root mismatch");
  const store = new MemoryBlockstore(),
    blocks = new Set<string>();
  for await (const b of car.blocks()) {
    const k = b.cid.toString();
    if (
      blocks.has(k) ||
      b.cid.version !== 1 ||
      ![0x55, 0x70].includes(b.cid.code) ||
      !CID.createV1(b.cid.code, await multihash.digest(b.bytes)).equals(b.cid)
    )
      throw new Error("Candidate CAR block integrity");
    blocks.add(k);
    await store.put(b.cid, b.bytes);
  }
  const seen = new Set<string>();
  const tracking = {
    get: async function* (cid: CID) {
      seen.add(cid.toString());
      yield* store.get(cid);
    },
  };
  const names = files.map((f) => f.name);
  if (
    new Set(names).size !== names.length ||
    names.some(
      (n) => !/^(base|official)\/[a-z0-9.-]+$|^candidate-schema\.json$/.test(n),
    )
  )
    throw new Error("Candidate logical file profile");
  async function directory(prefix: string) {
    const entry = await exporter(
      rootCid + (prefix ? "/" + prefix : ""),
      tracking,
    );
    if (entry.type !== "directory")
      throw new Error("Candidate directory required");
    const expected = [
      ...new Set(
        names
          .filter((n) => n.startsWith(prefix ? prefix + "/" : ""))
          .map((n) => n.slice(prefix ? prefix.length + 1 : 0).split("/")[0]!),
      ),
    ].sort();
    const actual = [];
    for await (const child of entry.entries()) actual.push(child.name);
    if (stableJson(actual.sort()) !== stableJson(expected))
      throw new Error("Unexpected candidate directory object");
    for (const name of expected) {
      const child = prefix ? prefix + "/" + name : name;
      if (names.some((n) => n.startsWith(child + "/"))) await directory(child);
    }
  }
  await directory("");
  for (const f of files) {
    const entry = await exporter(rootCid + "/" + f.name, tracking);
    if (entry.type !== "raw" && entry.type !== "file")
      throw new Error("Candidate file required");
    const got = await digest(entry.content());
    if (got.bytes !== f.bytes || got.sha256 !== f.sha256)
      throw new Error("Candidate retrieved file digest mismatch");
  }
  if (seen.size !== blocks.size || [...blocks].some((k) => !seen.has(k)))
    throw new Error("Unreachable candidate CAR block");
  return {
    rootCid,
    files: files.length,
    blocks: blocks.size,
    bytesVerified: files.reduce((n, f) => n + f.bytes, 0),
  };
}
export function exactCandidateApproval(candidate: {
  rootCid: string;
  car: { sha256: string };
}): string {
  if (
    CID.parse(candidate.rootCid).version !== 1 ||
    !HASH.test(candidate.car.sha256)
  )
    throw new Error("Exact candidate identity required");
  return `APPROVE PUBLIC P11 CANDIDATE CID ${candidate.rootCid} CAR SHA256 ${candidate.car.sha256}`;
}
/** A later uploader must use this gate for the reviewed exact bytes. No uploader is supplied here. */
export function assertExactCandidateApproval(
  candidate: { rootCid: string; car: { sha256: string } },
  phrase: string | undefined,
) {
  if (phrase !== exactCandidateApproval(candidate))
    throw new Error(
      "Separate exact-byte Human publication approval required; video/Git approval is insufficient",
    );
}
export async function buildOfficialPublicationCandidate(options: {
  baseDirectory: string;
  basePublicationSha256: string;
  officialDirectory: string;
  outputDirectory: string;
}) {
  if (!HASH.test(options.basePublicationSha256))
    throw new Error("Pinned base publication required");
  const baseRaw = await bounded(
    path.join(options.baseDirectory, "publication-manifest.json"),
    1024 ** 2,
  );
  if (sha256(baseRaw) !== options.basePublicationSha256)
    throw new Error("Base publication metadata changed");
  const base = JSON.parse(baseRaw.toString()) as {
    rootCid: string;
    snapshotId: string;
    datasetDigest: string;
    publicationProfile?: string;
    files: File[];
  };
  if (
    CID.parse(base.rootCid).version !== 1 ||
    !base.snapshotId ||
    !HASH.test(base.datasetDigest)
  )
    throw new Error("Historical base identity required");
  const allowed = !base.publicationProfile
    ? PUBLICATION_FILES
    : ["run-history-v2", "run-history-v3"].includes(base.publicationProfile)
      ? RUN_PUBLICATION_FILES
      : [];
  if (
    stableJson(base.files.map((f) => f.name).sort()) !==
    stableJson([...allowed].sort())
  )
    throw new Error("Historical base file allowlist");
  const ownerRaw = await bounded(
    path.join(options.officialDirectory, "field-decision.json"),
    1024 ** 2,
  );
  const owner = DecisionSchema.parse(JSON.parse(ownerRaw.toString()));
  const profileRaw = await bounded(
    path.join(options.officialDirectory, "official-parcel-profile.json"),
    1024 ** 2,
  );
  const envelope = ProfileSchema.parse(JSON.parse(profileRaw.toString()));
  if (
    ownerRaw.toString() !== stableJson(owner) + "\n" ||
    profileRaw.toString() !== stableJson(envelope) + "\n"
  )
    throw new Error(
      "Canonical exact metadata required; duplicate or unreviewed JSON bytes rejected",
    );
  const profile = envelope.profile;
  validateSourceFieldProfile(profile, {
    sourceUrl: profile.sourceUrl,
    termsSha256: profile.termsSha256,
    fieldClassificationDigest: envelope.fieldClassificationDigest,
    requestedFields: ["NAME1", "NAME2", "POSTALADDRESS"],
  });
  if (
    envelope.publicSnapshotId !== base.snapshotId ||
    owner.retainedSourceFileSha256 !== envelope.sourceFileSha256 ||
    owner.sourceMetadataSha256 !== profile.sourceMetadataSha256 ||
    owner.sourceTermsUrl !== profile.termsUrl ||
    stableJson(owner.metadataEligibleFields) !==
      stableJson(eligiblePublicationFields(profile)) ||
    owner.fields.some((f) => !owner.metadataEligibleFields.includes(f))
  )
    throw new Error("Candidate metadata source/snapshot binding mismatch");
  if (
    owner.state !==
      "LOCAL_EXACT_BYTES_CANDIDATE_REQUIRES_HUMAN_APPROVAL_BEFORE_UPLOAD" ||
    owner.uploadAuthorized !== false ||
    owner.providerRestrictedRowsIncluded !== false ||
    owner.publicSnapshotId !== base.snapshotId ||
    owner.rows !== envelope.sourceRecordCount ||
    owner.sourceTermsSha256 !== profile.termsSha256 ||
    owner.fieldClassificationDigest !== sourceFieldProfileDigest(profile) ||
    envelope.fieldClassificationDigest !== owner.fieldClassificationDigest ||
    profile.sourceId !== "official-oakland-tax-parcel-full-attributes" ||
    profile.sourceUrl !==
      "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1" ||
    !HASH.test(profile.termsSha256) ||
    !HASH.test(profile.sourceMetadataSha256) ||
    !Number.isSafeInteger(owner.rows) ||
    owner.rows < 1 ||
    owner.rows > 1_200_000 ||
    owner.files.length !== 1 ||
    owner.files[0]!.name !== OWNER_FILES[0] ||
    !["NAME1", "NAME2", "POSTALADDRESS"].every((f) =>
      owner.metadataEligibleFields.includes(f),
    ) ||
    Object.values(profile.fields).some(
      (f) => f.classification !== "official_public",
    )
  )
    throw new Error(
      "Only exact source-permitted official fields are candidate eligible; restricted provider/credential rows excluded",
    );
  const sources: {
    name: string;
    file?: string;
    body?: Buffer;
    bytes: number;
    sha256: string;
  }[] = [];
  for (const f of base.files) {
    if (
      !HASH.test(f.sha256) ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > 128 * 1024 ** 2
    )
      throw new Error("Base file bound");
    const file = path.join(options.baseDirectory, f.name),
      bytes = await bounded(file, 128 * 1024 ** 2);
    if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256)
      throw new Error("Historical base file changed");
    sources.push({ ...f, name: "base/" + f.name, file });
  }
  const heldMetadata = new Map<string, Buffer>([
    ["field-decision.json", ownerRaw],
    ["official-parcel-profile.json", profileRaw],
  ]);
  for (const name of OWNER_FILES) {
    const file = path.join(options.officialDirectory, name),
      bytes = heldMetadata.get(name) ?? (await bounded(file, 128 * 1024 ** 2));
    const expected = owner.files.find((f) => f.name === name);
    if (
      expected &&
      (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256)
    )
      throw new Error("Official candidate file changed");
    sources.push({
      name: "official/" + name,
      ...(heldMetadata.has(name) ? { body: bytes } : { file }),
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  const schema = Buffer.from(
    stableJson({
      version: "p11-layered-official-candidate-v1",
      contractVersion: CONTRACT_VERSION,
      base: {
        rootCid: base.rootCid,
        snapshotId: base.snapshotId,
        datasetDigest: base.datasetDigest,
        publicationManifestSha256: options.basePublicationSha256,
        unchanged: true,
      },
      official: {
        rows: owner.rows,
        populatedNameValues: owner.populatedNameValues,
        observedFieldCounts: owner.observedFieldCounts,
        sourceTermsSha256: profile.termsSha256,
        fieldClassificationDigest: owner.fieldClassificationDigest,
      },
      state: "LOCAL_UNPUBLISHED",
      restrictedProviderRowsIncluded: false,
      mutableCrmLeadsIncluded: false,
      credentialsIncluded: false,
    }) + "\n",
  );
  sources.push({
    name: "candidate-schema.json",
    body: schema,
    bytes: schema.length,
    sha256: sha256(schema),
  });
  sources.sort((a, b) => (a.name < b.name ? -1 : 1));
  if (sources.reduce((n, f) => n + f.bytes, 0) > 128 * 1024 ** 2)
    throw new Error("Candidate aggregate byte ceiling");
  await mkdir(options.outputDirectory, { mode: 0o700 });
  const store = new MemoryBlockstore();
  const imported: ImportResult[] = [];
  for await (const item of importer(
    sources.map((f) => ({
      path: f.name,
      content: f.body ?? createReadStream(f.file!),
    })),
    store,
    {
      cidVersion: 1,
      rawLeaves: true,
      wrapWithDirectory: true,
      chunker: fixedSize({ chunkSize: 262144 }),
      layout: balanced({ maxChildrenPerNode: 174 }),
      fileImportConcurrency: 1,
      blockWriteConcurrency: 1,
    },
  ))
    imported.push(item);
  const root = imported.find((i) => i.path === ""),
    baseRoot = imported.find((i) => i.path === "base");
  if (!root || baseRoot?.cid.toString() !== base.rootCid)
    throw new Error("Historical base CID changed during composition");
  const visited = new Set<string>();
  const tracking = {
    get: async function* (cid: CID) {
      visited.add(cid.toString());
      yield* store.get(cid);
    },
  };
  for (const f of sources) {
    const e = await exporter(root.cid.toString() + "/" + f.name, tracking);
    if (e.type !== "file" && e.type !== "raw")
      throw new Error("Unexpected candidate DAG node");
    const got = await digest(e.content());
    if (got.sha256 !== f.sha256 || got.bytes !== f.bytes)
      throw new Error("Candidate import digest mismatch");
  }
  const { writer, out } = CarWriter.create([root.cid]);
  const carFile = path.join(options.outputDirectory, "candidate.car");
  const writing = (async () => {
    const f = await open(carFile, "wx", 0o600);
    try {
      for await (const b of out) await f.write(b);
    } finally {
      await f.close();
    }
  })();
  for (const key of [...visited].sort()) {
    const cid = CID.parse(key);
    await writer.put({ cid, bytes: await all(store.get(cid)) });
  }
  await writer.close();
  await writing;
  const files = sources.map((f) => ({
    name: f.name,
    bytes: f.bytes,
    sha256: f.sha256,
    cid: imported.find((i) => i.path === f.name)!.cid.toString(),
    codec: "file" as const,
  }));
  const proof = await verifyOfficialCandidateCar(
    carFile,
    root.cid.toString(),
    files,
  );
  const carBytes = await bounded(carFile, 140 * 1024 ** 2);
  const manifest = {
    version: "p11-local-publication-candidate-v1",
    state: "LOCAL_UNPUBLISHED_REQUIRES_SEPARATE_EXACT_HUMAN_APPROVAL",
    uploadAuthorized: false,
    rootCid: root.cid.toString(),
    rootCodec: "directory",
    cidVersion: 1,
    contractVersion: CONTRACT_VERSION,
    historicalBase: {
      rootCid: base.rootCid,
      snapshotId: base.snapshotId,
      unchanged: true,
    },
    sourceUrl: profile.sourceUrl,
    sourceTermsUrl: profile.termsUrl,
    fields: owner.fields,
    metadataEligibleFields: owner.metadataEligibleFields,
    observedFieldCounts: owner.observedFieldCounts,
    retainedSourceFileSha256: envelope.sourceFileSha256,
    retainedSourceSchemaSha256: envelope.sourceSchemaSha256,
    currentAvailabilityCensusObservedAt: envelope.availability.observedAt,
    currentCensusDoesNotRefreshRetainedRows: true,
    sourceTermsSha256: profile.termsSha256,
    sourceMetadataSha256: profile.sourceMetadataSha256,
    fieldClassificationDigest: owner.fieldClassificationDigest,
    rows: owner.rows,
    populatedNameValues: owner.populatedNameValues,
    mailingAddressIncluded: true,
    providerRestrictedRowsIncluded: false,
    files,
    car: {
      name: "candidate.car",
      bytes: carBytes.length,
      sha256: sha256(carBytes),
      ...proof,
    },
    permanence:
      "A later IPFS upload can be permanently replicated; unpinning cannot guarantee erasure. No upload or pin change occurred.",
    gatewayRetrieval: "NOT_PERFORMED_LOCAL_CANDIDATE_ONLY",
    replication: "NOT_PERFORMED_LOCAL_CANDIDATE_ONLY",
  };
  await writeFile(
    path.join(options.outputDirectory, "publication-candidate-manifest.json"),
    stableJson({
      ...manifest,
      requiredApprovalPhrase: exactCandidateApproval(manifest),
    }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(
    path.join(options.outputDirectory, "candidate-schema.json"),
    schema,
    { flag: "wx", mode: 0o600 },
  );
  return manifest;
}
