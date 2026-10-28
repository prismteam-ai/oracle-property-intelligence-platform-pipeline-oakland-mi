import { z } from "zod";
import { PropertySchema, PermitSchema } from "../../contracts/src/index.ts";
import { FULL_SOURCE_DEFINITIONS } from "./private-full-source.ts";
import { sha256 } from "./model.ts";
import { classifyTroyPermit } from "./troy.ts";
const definition = FULL_SOURCE_DEFINITIONS["rochester-source"];
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const Envelope = z
  .object({
    version: z.literal(definition.version),
    source_id: z.literal(definition.sourceId),
    native_id: z.string().regex(/^[a-f0-9]{64}:row:[1-9][0-9]{0,5}$/),
    public_snapshot_id: z.string(),
    source_schema_sha256: hash,
    source_record_json: z.string(),
    record_digest: hash,
    observed_at: z.iso.datetime(),
    property_id: z.string().min(1).max(200).nullable(),
  })
  .strict();
const Source = z
  .object({
    rowOrdinal: z.number().int().positive(),
    rowSourceRecordId: z.string(),
    sourcePdfSha256: hash,
    reportKind: z.enum(["issued", "applied"]),
    eventDateIso: z.iso.date(),
    issuedDateIso: z.iso.date().nullable(),
    appliedDateIso: z.iso.date().nullable(),
    reportedOwnerNameRaw: z.string().max(2000).nullable(),
    ownershipEffectiveDate: z.null(),
    propertyAddressRaw: z.string().min(1).max(2000).nullable(),
    workCategoryRaw: z.string().max(4000).nullable(),
    workDescriptionLinesRaw: z.array(z.string().max(8000)).max(100),
    sourceObservedAt: z.iso.datetime({ offset: true }),
  })
  .passthrough();
const Owner =
  PropertySchema.shape.ownership.shape.reportedOwnerObservations.unwrap()
    .element;
/** Source labels remain observations: no ownership date, legal role, contractor role or lifecycle inference. */
export function projectRochesterReportRow(
  input: unknown,
  snapshotId: string,
  schemaSha256: string,
) {
  try {
    const row = Envelope.parse(input);
    if (
      row.public_snapshot_id !== snapshotId ||
      row.source_schema_sha256 !== schemaSha256 ||
      Buffer.byteLength(row.source_record_json) > 128 * 1024 ||
      sha256(row.source_record_json) !== row.record_digest
    )
      throw Error();
    const source = Source.parse(JSON.parse(row.source_record_json));
    if (
      row.native_id !== source.sourcePdfSha256 + ":row:" + source.rowOrdinal ||
      source.rowSourceRecordId !== row.native_id ||
      new Date(source.sourceObservedAt).toISOString() !==
        new Date(row.observed_at).toISOString() ||
      source.eventDateIso > row.observed_at.slice(0, 10) ||
      (row.property_id !== null && source.propertyAddressRaw === null) ||
      (source.reportKind === "issued"
        ? source.issuedDateIso !== source.eventDateIso ||
          source.appliedDateIso !== null
        : source.appliedDateIso !== source.eventDateIso ||
          source.issuedDateIso !== null)
    )
      throw Error();
    const provenance = [
      {
        sourceId: row.source_id,
        recordId: row.native_id,
        observedAt: row.observed_at,
        digest: row.record_digest,
        kind: "real-minimized" as const,
      },
    ];
    const owner =
      row.property_id && source.reportedOwnerNameRaw?.trim()
        ? Owner.parse({
            reportedName: source.reportedOwnerNameRaw,
            sourceLabel: "Owner",
            relatedPermitEvent: {
              kind: source.reportKind,
              date: source.eventDateIso,
            },
            ownershipEffectiveDate: null,
            roleVerification: "source_reported_unverified",
            provenance,
            limitations: [
              "The city report labels this field Owner. Its effective ownership date, current legal role and role at the related permit event are unverified.",
              "The separate unlabeled grouping-party contact headers are not attributed to this owner or a contractor.",
              "This observation supplies no transfer event or uninterrupted ownership proof.",
            ],
          })
        : null;
    const classification = classifyTroyPermit(
      "PB issued-building report",
      [source.workCategoryRaw ?? "", ...source.workDescriptionLinesRaw].join(
        "\n",
      ),
    );
    const permit =
      row.property_id && source.reportKind === "issued"
        ? PermitSchema.parse({
            id: "rochester-issued-" + sha256(row.native_id).slice(0, 24),
            jurisdiction: "City of Rochester Hills, Oakland County, Michigan",
            issuedAt: source.issuedDateIso,
            status: "unknown",
            statusBasis: "issued_only",
            reportedStatus: "ISSUED (monthly report)",
            statusObservedAt: row.observed_at,
            reportedPermitType: "PB-prefix issued-building report",
            kind: classification.kind,
            proposedWorkScope: classification.proposedWorkScope,
            openedAt: null,
            closedAt: null,
            contractor: {
              reportedName: null,
              verifiedCompanyId: null,
              license: null,
              rating: null,
            },
            matchEvidence: {
              basis: "exact_normalized_site_address",
              confidence: "medium",
              score: 0.9,
              candidateCount: 1,
              addressAgreement: "agrees",
              caveats: [
                "Exact normalized site address and Rochester Hills jurisdiction only; no native permit number or parcel PIN is printed.",
                "Current address association does not prove historical parcel or owner identity.",
                "Report inclusion establishes issuance only; current status, completion and continuous open duration remain unknown.",
              ],
            },
            provenance,
          })
        : null;
    return { row, source, owner, permit, openDays: null };
  } catch {
    throw Error(
      "Protected Rochester report source/projection boundary rejected",
    );
  }
}
