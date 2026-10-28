import { z } from "zod";
import {
  PermitSchema,
  ProvenanceSchema,
  type Permit,
} from "../../contracts/src/index.ts";
import { sha256 } from "./model.ts";
import { TROY_SOURCE, troyBusinessName } from "./troy.ts";
export const PRIVATE_PERMIT_LIMIT = 750;
export const PRIVATE_PERMIT_JSON_BYTES = 16_384;
const StrictLicense = PermitSchema.shape.contractor.shape.licenseEvidence
  .unwrap()
  .unwrap()
  .strict();
const StrictRating = PermitSchema.shape.contractor.shape.ratingEvidence
  .unwrap()
  .unwrap()
  .strict();
const StrictPermit = PermitSchema.extend({
  matchEvidence: PermitSchema.shape.matchEvidence.unwrap().strict(),
  contractor: PermitSchema.shape.contractor
    .extend({
      licenseEvidence: StrictLicense.nullable().optional(),
      ratingEvidence: StrictRating.nullable().optional(),
    })
    .strict(),
  provenance: z.array(ProvenanceSchema.strict()).min(1).max(10),
}).strict();
const Row = z
  .object({
    property_id: z.string().min(1).max(200),
    permit_json: z.string().min(1),
    public_snapshot_id: z.string().min(1).max(200),
    source_id: z.literal(TROY_SOURCE),
    native_id: z.string().min(1).max(120),
    record_digest: z.string().regex(/^[a-f0-9]{64}$/),
    observed_at: z.iso.datetime(),
  })
  .strict();
const allowedSources = new Set([
  TROY_SOURCE,
  "official-troy-bsa-permit-status",
  "official-troy-permit-status",
  "michigan-lara-license-verification",
  "bbb-business-profile",
]);
const time = (stamp: string) => Date.parse(stamp);
function boundedJson(value: unknown, depth = 0): void {
  if (depth > 8) throw new Error("Protected permit JSON nesting rejected");
  if (typeof value === "string" && value.length > 2048)
    throw new Error("Protected permit string bound rejected");
  if (Array.isArray(value)) {
    if (value.length > 20)
      throw new Error("Protected permit array bound rejected");
    for (const x of value) boundedJson(x, depth + 1);
  } else if (value && typeof value === "object")
    for (const x of Object.values(value)) boundedJson(x, depth + 1);
}
function evidenceUrl(value: string, kind: "license" | "rating") {
  const u = new URL(value);
  const host = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.href.length > 2048 ||
    [...u.searchParams.keys()].some((k) =>
      /token|secret|session|password|credential|signature|authorization/i.test(
        k,
      ),
    ) ||
    (kind === "license"
      ? ![
          "michigan.gov",
          "www.michigan.gov",
          "aca-prod.accela.com",
          "aca3.accela.com",
        ].includes(host)
      : !["bbb.org", "www.bbb.org"].includes(host))
  )
    throw new Error("Protected contractor evidence URL rejected");
}
export function validateProtectedPermitRow(
  input: unknown,
  publicSnapshotId: string,
) {
  try {
    const row = Row.parse(input);
    if (
      row.public_snapshot_id !== publicSnapshotId ||
      Buffer.byteLength(row.permit_json) > PRIVATE_PERMIT_JSON_BYTES
    )
      throw new Error();
    const raw = JSON.parse(row.permit_json) as unknown;
    boundedJson(raw);
    const permit = StrictPermit.parse(raw);
    if (
      permit.id !== "troy-issued-" + sha256(row.native_id).slice(0, 24) ||
      permit.permitNumber !== row.native_id ||
      !permit.issuedAt ||
      permit.issuedAt > row.observed_at.slice(0, 10) ||
      permit.jurisdiction !== "City of Troy, Oakland County, Michigan" ||
      permit.reportedPermitType !== "Res., Roof" ||
      permit.kind === "other" ||
      !permit.proposedWorkScope ||
      !permit.matchEvidence ||
      permit.matchEvidence.candidateCount !== 1 ||
      !["exact_normalized_parcel", "exact_normalized_site_address"].includes(
        permit.matchEvidence.basis,
      )
    )
      throw new Error();
    if (
      !permit.provenance.every(
        (p) =>
          allowedSources.has(p.sourceId) &&
          p.kind === "real-minimized" &&
          p.recordId.length <= 200 &&
          /^[A-Za-z0-9._:/ -]+$/.test(p.recordId) &&
          /^[a-f0-9]{64}$/.test(p.digest) &&
          time(p.observedAt) <= time(row.observed_at),
      )
    )
      throw new Error();
    if (
      !permit.provenance.some(
        (p) =>
          p.sourceId === TROY_SOURCE &&
          p.recordId === row.native_id &&
          p.digest === row.record_digest,
      )
    )
      throw new Error();
    const hasStatus = permit.provenance.some((p) =>
      [
        "official-troy-bsa-permit-status",
        "official-troy-permit-status",
      ].includes(p.sourceId),
    );
    if (permit.statusBasis === "issued_only") {
      if (
        permit.status !== "unknown" ||
        permit.openedAt !== null ||
        permit.closedAt !== null ||
        permit.reportedStatus !== null ||
        permit.statusObservedAt !== undefined
      )
        throw new Error();
    } else if (
      permit.statusBasis === "explicit_open" ||
      permit.statusBasis === "explicit_closed"
    ) {
      if (
        !hasStatus ||
        !permit.reportedStatus ||
        !permit.statusObservedAt ||
        time(permit.statusObservedAt) > time(row.observed_at) ||
        !permit.provenance.some(
          (p) =>
            [
              "official-troy-bsa-permit-status",
              "official-troy-permit-status",
            ].includes(p.sourceId) &&
            time(p.observedAt) === time(permit.statusObservedAt!),
        ) ||
        permit.status !==
          (permit.statusBasis === "explicit_open" ? "open" : "closed") ||
        (permit.status === "open" && permit.closedAt !== null)
      )
        throw new Error();
    } else if (
      permit.statusBasis !== "unknown" ||
      permit.status !== "unknown" ||
      permit.openedAt !== null ||
      permit.closedAt !== null
    )
      throw new Error();
    const asOf =
      permit.statusObservedAt?.slice(0, 10) ?? row.observed_at.slice(0, 10);
    if (
      (permit.openedAt && permit.openedAt > asOf) ||
      (permit.closedAt && permit.closedAt > asOf) ||
      (permit.openedAt && permit.closedAt && permit.closedAt < permit.openedAt)
    )
      throw new Error();
    if (
      permit.contractor.reportedName !== null &&
      troyBusinessName(permit.contractor.reportedName) !==
        permit.contractor.reportedName
    )
      throw new Error();
    if (permit.contractor.licenseEvidence) {
      const e = permit.contractor.licenseEvidence;
      evidenceUrl(e.sourceUrl, "license");
      if (
        time(e.observedAt) > time(row.observed_at) ||
        !permit.provenance.some(
          (p) =>
            p.sourceId === "michigan-lara-license-verification" &&
            time(p.observedAt) === time(e.observedAt),
        )
      )
        throw new Error();
    }
    if (
      permit.contractor.license !== null &&
      (!permit.contractor.licenseEvidence ||
        permit.contractor.license !==
          permit.contractor.licenseEvidence.identifier ||
        !["high", "medium"].includes(
          permit.contractor.licenseEvidence.confidence,
        ))
    )
      throw new Error();
    if (
      permit.contractor.verifiedCompanyId !== null &&
      !permit.contractor.licenseEvidence
    )
      throw new Error();
    if (permit.contractor.ratingEvidence) {
      evidenceUrl(permit.contractor.ratingEvidence.sourceUrl, "rating");
      if (
        time(permit.contractor.ratingEvidence.observedAt) >
          time(row.observed_at) ||
        !permit.provenance.some(
          (p) =>
            p.sourceId === "bbb-business-profile" &&
            time(p.observedAt) ===
              time(permit.contractor.ratingEvidence!.observedAt),
        )
      )
        throw new Error();
    }
    // A BBB letter grade is not a numeric0–100rating. Keep the observed scale/value separately.
    if (permit.contractor.rating !== null) throw new Error();
    return {
      row,
      permit: permit as Permit,
      openDays: protectedPermitOpenDays(permit, asOf),
    };
  } catch {
    throw new Error("Protected permit row/schema/binding/evidence rejected");
  }
}
const ObservationProof = z.object({
  recordId: z.string().min(1).max(200),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const PermitObservationOverlay = z
  .object({
    version: z.literal("1"),
    observations: z
      .array(
        z
          .object({
            permitNumber: z.string().min(1).max(120),
            status: ObservationProof.extend({
              state: z.enum(["open", "closed"]),
              reportedStatus: z.string().min(1).max(120),
              openedAt: z.iso.date().nullable(),
              closedAt: z.iso.date().nullable(),
              sourceId: z.enum([
                "official-troy-permit-status",
                "official-troy-bsa-permit-status",
              ]),
              sourceUrl: z.string().url(),
              observedAt: z.iso.datetime(),
            })
              .strict()
              .optional(),
            license: StrictLicense.extend({
              recordId: ObservationProof.shape.recordId,
              digest: ObservationProof.shape.digest,
            })
              .strict()
              .optional(),
            rating: StrictRating.extend({
              recordId: ObservationProof.shape.recordId,
              digest: ObservationProof.shape.digest,
            })
              .strict()
              .optional(),
          })
          .strict()
          .refine(
            (x) => Boolean(x.status || x.license || x.rating),
            "An explicit observation is required",
          ),
      )
      .max(PRIVATE_PERMIT_LIMIT),
  })
  .strict();
/** Apply only independently observed facts. This function performs no network activity. */
export function applyProtectedPermitObservations(
  inputRows: unknown[],
  input: unknown,
  publicSnapshotId: string,
) {
  if (inputRows.length > PRIVATE_PERMIT_LIMIT)
    throw new Error("Protected permit cohort bound rejected");
  const rows = inputRows.map(
    (x) => validateProtectedPermitRow(x, publicSnapshotId).row,
  );
  const overlay = PermitObservationOverlay.parse(input),
    seen = new Set<string>();
  const additions = new Map(
    overlay.observations.map((x) => {
      if (seen.has(x.permitNumber))
        throw new Error("Duplicate observation permit identity");
      seen.add(x.permitNumber);
      return [x.permitNumber, x] as const;
    }),
  );
  const output = rows.map((row) => {
    const observation = additions.get(row.native_id);
    if (!observation) return row;
    additions.delete(row.native_id);
    const permit = validateProtectedPermitRow(row, publicSnapshotId).permit;
    const add = (
      sourceId: string,
      proof: { recordId: string; digest: string; observedAt: string },
    ) => {
      permit.provenance.push({
        sourceId,
        recordId: proof.recordId,
        digest: proof.digest,
        observedAt: proof.observedAt,
        kind: "real-minimized",
      });
      if (time(proof.observedAt) > time(row.observed_at))
        row.observed_at = proof.observedAt;
    };
    if (observation.status) {
      const s = observation.status,
        u = new URL(s.sourceUrl);
      if (
        u.protocol !== "https:" ||
        !["apps.troymi.gov", "troymi.gov", "www.troymi.gov"].includes(
          u.hostname,
        ) ||
        u.username ||
        u.password ||
        u.port ||
        [...u.searchParams.keys()].some((k) =>
          /token|secret|session|password|credential|signature|authorization/i.test(
            k,
          ),
        )
      )
        throw new Error("Official Troy status URL rejected");
      Object.assign(permit, {
        status: s.state,
        statusBasis: s.state === "open" ? "explicit_open" : "explicit_closed",
        reportedStatus: s.reportedStatus,
        statusObservedAt: s.observedAt,
        openedAt: s.openedAt,
        closedAt: s.closedAt,
      });
      add(s.sourceId, s);
    }
    if (observation.license) {
      const { recordId, digest, ...evidence } = observation.license;
      permit.contractor.licenseEvidence = evidence;
      permit.contractor.license = ["high", "medium"].includes(
        evidence.confidence,
      )
        ? evidence.identifier
        : null;
      add("michigan-lara-license-verification", {
        recordId,
        digest,
        observedAt: evidence.observedAt,
      });
    }
    if (observation.rating) {
      const { recordId, digest, ...evidence } = observation.rating;
      permit.contractor.ratingEvidence = evidence;
      add("bbb-business-profile", {
        recordId,
        digest,
        observedAt: evidence.observedAt,
      });
    }
    row.permit_json = JSON.stringify(permit);
    return validateProtectedPermitRow(row, publicSnapshotId).row;
  });
  if (additions.size)
    throw new Error(
      "Observation has no unique staged permit; no output promoted",
    );
  return output;
}
export function protectedPermitOpenDays(
  permit: Permit,
  asOf: string,
): number | null {
  if (
    permit.status !== "open" ||
    permit.statusBasis !== "explicit_open" ||
    !permit.openedAt
  )
    return null;
  const days =
    (Date.parse(asOf + "T00:00:00Z") -
      Date.parse(permit.openedAt + "T00:00:00Z")) /
    86400000;
  return Number.isFinite(days) && days >= 0 ? Math.floor(days) : null;
}
