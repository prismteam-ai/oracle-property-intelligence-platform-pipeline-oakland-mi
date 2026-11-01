import { expect, test } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CarReader, CarWriter } from "@ipld/car";
import { CID } from "multiformats/cid";
import { sha256 as multihash } from "multiformats/hashes/sha2";
import {
  rehearsePublication,
  PUBLICATION_FILES,
} from "../packages/publication/src/local.ts";
import {
  buildOfficialPublicationCandidate,
  verifyOfficialCandidateCar,
  exactCandidateApproval,
  assertExactCandidateApproval,
} from "../packages/publication/src/official-parcel-candidate.ts";
import { createOfficialParcelProfile } from "../packages/county/src/official-parcel.ts";
import {
  eligiblePublicationFields,
  sourceFieldProfileDigest,
} from "../packages/source-profiles/src/field-authority.ts";
import { sha256, stableJson } from "../packages/county/src/model.ts";
import { CONTRACT_VERSION } from "../packages/contracts/src/index.ts";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "p11-candidate-")),
    base = path.join(root, "base"),
    official = path.join(root, "official");
  await mkdir(base);
  await mkdir(official);
  const snapshotId = "oakland-real-" + "a".repeat(20),
    digest = "b".repeat(64),
    files = [];
  for (const name of [...PUBLICATION_FILES, "runs.json"]) {
    const body = stableJson(
      name === "dataset-manifest.json"
        ? { snapshotId, digest }
        : name === "runs.json"
          ? []
          : { syntheticByteFixture: name },
    );
    await writeFile(path.join(base, name), body);
    files.push({ name, bytes: Buffer.byteLength(body), sha256: sha256(body) });
  }
  await writeFile(
    path.join(base, "artifact-manifest.json"),
    stableJson({
      version: "1",
      contractVersion: CONTRACT_VERSION,
      snapshotId,
      digest,
      count: 1,
      addressCount: 1,
      parcelCount: 1,
      files,
    }),
  );
  const publication = await rehearsePublication(base);
  const profile = createOfficialParcelProfile({
    source: {
      role: "county-parcels",
      file: path.join(root, "synthetic-source.parquet"),
      sha256: "c".repeat(64),
      sourceSchemaSha256: "d".repeat(64),
      sourceRecordCount: 1,
      sourceValidationSha256: "e".repeat(64),
      sourceValidatedOffline: true,
    },
    publicSnapshotId: snapshotId,
    census: {
      endpoint:
        "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1",
      sourceMetadata: {
        layerBodySha256: "f".repeat(64),
        completeFieldNames: ["NAME1", "NAME2", "POSTALADDRESS"],
      },
      observedIntervalUtc: { closingCountFinishedAt: "2026-10-30T05:00:00Z" },
      currentPopulation: { closingTotal: 1 },
      fields: {
        NAME1: {
          exposed: true,
          sourceAvailability: "EXPOSED_BUT_NULL_OR_EMPTY",
          nonNullCount: 0,
          nonNullAndNotEmptyStringCount: 0,
        },
        NAME2: {
          exposed: true,
          sourceAvailability: "EXPOSED_BUT_NULL_OR_EMPTY",
          nonNullCount: 0,
          nonNullAndNotEmptyStringCount: 0,
        },
        POSTALADDRESS: {
          exposed: true,
          sourceAvailability: "AVAILABLE",
          nonNullCount: 1,
          nonNullAndNotEmptyStringCount: 1,
        },
        PHONE: { exposed: false, sourceAvailability: "NOT_IN_SOURCE" },
        EMAIL: { exposed: false, sourceAvailability: "NOT_IN_SOURCE" },
      },
    },
    censusSha256: "1".repeat(64),
    termsUrl: "https://www.oaklandcountymi.gov/government/open-data-agreement",
    termsSha256: "2".repeat(64),
  });
  const bytes = Buffer.from(
    "SYNTHETIC_OFFICIAL_POSTAL_BYTE_FIXTURE_NOT_REAL_PARQUET",
  );
  await writeFile(
    path.join(official, "official-parcel-observations.parquet"),
    bytes,
  );
  const decision = {
    version: "official-parcel-publication-candidate-v1",
    state: "LOCAL_EXACT_BYTES_CANDIDATE_REQUIRES_HUMAN_APPROVAL_BEFORE_UPLOAD",
    uploadAuthorized: false,
    publicSnapshotId: snapshotId,
    retainedSourceFileSha256: profile.sourceFileSha256,
    sourceMetadataSha256: profile.profile.sourceMetadataSha256,
    sourceTermsUrl: profile.profile.termsUrl,
    uniqueNativeIds: 1,
    associatedProperties: 1,
    metadataEligibleFields: eligiblePublicationFields(profile.profile),
    nameFieldsPreservedAsObserved: true,
    mailingAddressIncludedAsObserved: true,
    observationsNotVerifiedLegalOwnership: true,
    currentAvailabilityCensusDoesNotReplaceHistoricalData: true,
    irreversiblePublicIpfsApproval:
      "PENDING_EXACT_CANDIDATE_BYTES_AND_CAR_ROOT_HUMAN_DECISION",
    cidAndCar:
      "Root combines these exact bytes with unchanged eligible base objects and computes the local CID/CAR; no upload performed by this exporter.",
    rows: 1,
    sourceTermsSha256: profile.profile.termsSha256,
    fieldClassificationDigest: profile.fieldClassificationDigest,
    populatedNameValues: 0,
    observedFieldCounts: {
      NAME1: {
        present: 1,
        populatedTrimmedString: 0,
        observedNullOrEmpty: 1,
        notObserved: 0,
      },
      NAME2: {
        present: 1,
        populatedTrimmedString: 0,
        observedNullOrEmpty: 1,
        notObserved: 0,
      },
      POSTALADDRESS: {
        present: 1,
        populatedTrimmedString: 1,
        observedNullOrEmpty: 0,
        notObserved: 0,
      },
    },
    providerRestrictedRowsIncluded: false,
    files: [
      {
        name: "official-parcel-observations.parquet",
        bytes: bytes.length,
        sha256: sha256(bytes),
      },
    ],
    fields: eligiblePublicationFields(profile.profile),
  };
  await writeFile(
    path.join(official, "field-decision.json"),
    stableJson(decision) + "\n",
  );
  await writeFile(
    path.join(official, "official-parcel-profile.json"),
    stableJson(profile) + "\n",
  );
  return {
    root,
    base,
    official,
    publication,
    profile,
    decision,
    options: {
      baseDirectory: base,
      basePublicationSha256: sha256(
        await readFile(path.join(base, "publication-manifest.json")),
      ),
      officialDirectory: official,
    },
  };
}

test("layered candidate is deterministic, retains the historical root and refuses unapproved publication", async () => {
  const f = await fixture();
  const first = await buildOfficialPublicationCandidate({
    ...f.options,
    outputDirectory: path.join(f.root, "candidate1"),
  });
  const second = await buildOfficialPublicationCandidate({
    ...f.options,
    outputDirectory: path.join(f.root, "candidate2"),
  });
  expect(second.rootCid).toBe(first.rootCid);
  expect(second.car.sha256).toBe(first.car.sha256);
  expect(first.historicalBase.rootCid).toBe(f.publication.rootCid);
  expect(first.historicalBase.unchanged).toBe(true);
  expect(first.uploadAuthorized).toBe(false);
  expect(first.populatedNameValues).toBe(0);
  expect(first.mailingAddressIncluded).toBe(true);
  expect(first.files).toHaveLength(12);
  expect(first.files.some((x) => /provider|credential|lead/.test(x.name))).toBe(
    false,
  );
  for (const phrase of [
    undefined,
    "APPROVE P11 V1.1 VIDEO AND DRAFT PR EFFECTS",
    exactCandidateApproval(first).toLowerCase(),
    exactCandidateApproval({ ...first, car: { sha256: "0".repeat(64) } }),
  ])
    expect(() => assertExactCandidateApproval(first, phrase)).toThrow(
      "exact-byte Human",
    );
  expect(() =>
    assertExactCandidateApproval(first, exactCandidateApproval(first)),
  ).not.toThrow();
  const car = await CarReader.fromBytes(
    await readFile(path.join(f.root, "candidate1/candidate.car")),
  );
  const { writer, out } = CarWriter.create(await car.getRoots());
  const collected = (async () => {
    const all = [];
    for await (const b of out) all.push(b);
    return Buffer.concat(all);
  })();
  for await (const b of car.blocks()) await writer.put(b);
  const bytes = Buffer.from("SYNTHETIC_RESTRICTED_PROVIDER_ROW");
  await writer.put({
    cid: CID.createV1(0x55, await multihash.digest(bytes)),
    bytes,
  });
  await writer.close();
  const extra = path.join(f.root, "extra.car");
  await writeFile(extra, await collected);
  await expect(
    verifyOfficialCandidateCar(extra, first.rootCid, first.files),
  ).rejects.toThrow("Unreachable");
});

test("changed official bytes or restricted field profiles cannot enter the public candidate", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.official, "official-parcel-observations.parquet"),
    "ALTERED_SYNTHETIC_BYTES",
  );
  await expect(
    buildOfficialPublicationCandidate({
      ...f.options,
      outputDirectory: path.join(f.root, "rejected1"),
    }),
  ).rejects.toThrow("Official candidate file changed");
  const g = await fixture();
  g.profile.profile.fields.POSTALADDRESS!.classification = "restricted_source";
  g.profile.profile.fields.POSTALADDRESS!.publication =
    "source_terms_restricted";
  g.profile.fieldClassificationDigest = sourceFieldProfileDigest(
    g.profile.profile,
  );
  g.decision.fieldClassificationDigest = g.profile.fieldClassificationDigest;
  g.decision.fields = eligiblePublicationFields(g.profile.profile);
  g.decision.metadataEligibleFields = eligiblePublicationFields(
    g.profile.profile,
  );
  await writeFile(
    path.join(g.official, "official-parcel-profile.json"),
    stableJson(g.profile) + "\n",
  );
  await writeFile(
    path.join(g.official, "field-decision.json"),
    stableJson(g.decision) + "\n",
  );
  await expect(
    buildOfficialPublicationCandidate({
      ...g.options,
      outputDirectory: path.join(g.root, "rejected2"),
    }),
  ).rejects.toThrow("restricted provider/credential");
});

test("metadata rejects extra payloads, duplicate keys, inconsistent finite counts and snapshot drift", async () => {
  for (const kind of [
    "decision-extra",
    "profile-extra",
    "count-extra",
    "rule-extra",
    "duplicate-key",
    "snapshot",
    "availability-count",
  ]) {
    const f = await fixture();
    if (kind === "decision-extra")
      await writeFile(
        path.join(f.official, "field-decision.json"),
        stableJson({
          ...f.decision,
          unexpected: "SYNTHETIC_RESTRICTED_CANARY",
        }) + "\n",
      );
    if (kind === "profile-extra")
      await writeFile(
        path.join(f.official, "official-parcel-profile.json"),
        stableJson({
          ...f.profile,
          unexpected: "SYNTHETIC_RESTRICTED_CANARY",
        }) + "\n",
      );
    if (kind === "count-extra")
      await writeFile(
        path.join(f.official, "field-decision.json"),
        stableJson({
          ...f.decision,
          observedFieldCounts: {
            ...f.decision.observedFieldCounts,
            NAME1: {
              ...f.decision.observedFieldCounts.NAME1,
              unexpected: "SYNTHETIC_RESTRICTED_CANARY",
            },
          },
        }) + "\n",
      );
    if (kind === "rule-extra")
      await writeFile(
        path.join(f.official, "official-parcel-profile.json"),
        stableJson({
          ...f.profile,
          profile: {
            ...f.profile.profile,
            fields: {
              ...f.profile.profile.fields,
              NAME1: {
                ...f.profile.profile.fields.NAME1,
                unexpected: "SYNTHETIC_RESTRICTED_CANARY",
              },
            },
          },
        }) + "\n",
      );
    if (kind === "duplicate-key") {
      const raw = await readFile(
        path.join(f.official, "field-decision.json"),
        "utf8",
      );
      await writeFile(
        path.join(f.official, "field-decision.json"),
        raw.replace(
          '"uploadAuthorized":false',
          '"uploadAuthorized":"SYNTHETIC_RESTRICTED_CANARY","uploadAuthorized":false',
        ),
      );
    }
    if (kind === "availability-count")
      await writeFile(
        path.join(f.official, "official-parcel-profile.json"),
        stableJson({
          ...f.profile,
          availability: {
            ...f.profile.availability,
            currentParcelRows: 1,
            fields: {
              ...f.profile.availability.fields,
              POSTALADDRESS: {
                ...f.profile.availability.fields.POSTALADDRESS,
                nonNullCount: 2,
              },
            },
          },
        }) + "\n",
      );
    if (kind === "snapshot")
      await writeFile(
        path.join(f.official, "official-parcel-profile.json"),
        stableJson({
          ...f.profile,
          publicSnapshotId: "oakland-real-" + "c".repeat(20),
        }) + "\n",
      );
    await expect(
      buildOfficialPublicationCandidate({
        ...f.options,
        outputDirectory: path.join(f.root, "rejected-" + kind),
      }),
    ).rejects.toThrow();
  }
  const f = await fixture();
  await writeFile(
    path.join(f.official, "field-decision.json"),
    stableJson({ ...f.decision, populatedNameValues: 1 }) + "\n",
  );
  await expect(
    buildOfficialPublicationCandidate({
      ...f.options,
      outputDirectory: path.join(f.root, "rejected-count"),
    }),
  ).rejects.toThrow("inconsistent");
});

test("eligible metadata fields absent from retained records are not invented or required in exported fields", async () => {
  const f = await fixture();
  f.profile.profile.fields.UNOBSERVED_PUBLIC_FIELD = {
    classification: "official_public",
    exposed: true,
    acquisitionAllowed: true,
    runtimeAllowed: true,
    publication: "eligible_pending_human",
  };
  f.profile.fieldClassificationDigest = sourceFieldProfileDigest(
    f.profile.profile,
  );
  f.decision.fieldClassificationDigest = f.profile.fieldClassificationDigest;
  f.decision.metadataEligibleFields = eligiblePublicationFields(
    f.profile.profile,
  );
  await writeFile(
    path.join(f.official, "official-parcel-profile.json"),
    stableJson(f.profile) + "\n",
  );
  await writeFile(
    path.join(f.official, "field-decision.json"),
    stableJson(f.decision) + "\n",
  );
  const result = await buildOfficialPublicationCandidate({
    ...f.options,
    outputDirectory: path.join(f.root, "unobserved"),
  });
  expect(result.uploadAuthorized).toBe(false);
  expect(f.decision.fields).not.toContain("UNOBSERVED_PUBLIC_FIELD");
});

test("preserves schema-backed dotted ArcGIS area fields without weakening source classification", async () => {
  const f = await fixture();
  f.profile.profile.fields["Shape.area"] = {
    classification: "official_public",
    exposed: true,
    acquisitionAllowed: true,
    runtimeAllowed: true,
    publication: "eligible_pending_human",
  };
  f.profile.fieldClassificationDigest = sourceFieldProfileDigest(
    f.profile.profile,
  );
  f.decision.fieldClassificationDigest = f.profile.fieldClassificationDigest;
  f.decision.metadataEligibleFields = eligiblePublicationFields(
    f.profile.profile,
  );
  f.decision.fields = [...f.decision.fields, "Shape.area"].sort();
  await writeFile(
    path.join(f.official, "official-parcel-profile.json"),
    stableJson(f.profile) + "\n",
  );
  await writeFile(
    path.join(f.official, "field-decision.json"),
    stableJson(f.decision) + "\n",
  );
  const result = await buildOfficialPublicationCandidate({
    ...f.options,
    outputDirectory: path.join(f.root, "dotted"),
  });
  expect(result.fields).toContain("Shape.area");
  expect(result.uploadAuthorized).toBe(false);
});
