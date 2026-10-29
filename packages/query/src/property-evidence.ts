import type { DuckDBConnection } from "@duckdb/node-api";
import { PRIVATE_PERMIT_LIMIT } from "../../county/src/private-permits.ts";
import type { Row } from "./real-utils.ts";
export interface PropertyEvidence {
  addresses: Row[];
  count: Row[];
  owner: Row[];
  reportedOwners: Row[];
  locationProvenance: Row[];
  enrichment: Row[];
  assessmentCaveats: Row[];
  permits: Row[];
  deedObservations: Row[];
}
/** Nine bounded reads per page, rather than nine reads for every property. */
export async function loadPropertyEvidence(
  connection: DuckDBConnection,
  propertyIds: readonly string[],
): Promise<Map<string, PropertyEvidence>> {
  const ids = [...new Set(propertyIds)];
  if (ids.length > 200 || ids.some((id) => !id || id.length > 200))
    throw new Error("Property evidence batch bound rejected");
  const result = new Map<string, PropertyEvidence>(
    ids.map((id) => [
      id,
      {
        addresses: [],
        count: [{ n: "0" }],
        owner: [],
        reportedOwners: [],
        locationProvenance: [],
        enrichment: [],
        assessmentCaveats: [],
        permits: [],
        deedObservations: [],
      },
    ]),
  );
  if (!ids.length) return result;
  const members =
    "IN(SELECT json_extract_string(value,'$') FROM json_each($ids))";
  const queries: [keyof PropertyEvidence, string][] = [
    [
      "addresses",
      `SELECT * EXCLUDE(__rank) FROM (SELECT l.property_id AS __property_id,a.*,row_number() OVER(PARTITION BY l.property_id ORDER BY a.id) AS __rank FROM parcel_address_links l JOIN site_addresses a ON a.id=l.address_id WHERE l.property_id ${members}) WHERE __rank<=25 ORDER BY __property_id,id`,
    ],
    [
      "count",
      `SELECT property_id AS __property_id,count(*) AS n FROM parcel_address_links WHERE property_id ${members} GROUP BY property_id`,
    ],
    [
      "owner",
      `SELECT property_id AS __property_id,* FROM owner_derivatives WHERE property_id ${members} ORDER BY property_id,rowid`,
    ],
    [
      "reportedOwners",
      `SELECT property_id AS __property_id,canonical_json FROM private_reported_owner_observations WHERE property_id ${members} ORDER BY property_id,source_id,native_id,rowid`,
    ],
    [
      "locationProvenance",
      `SELECT property_id AS __property_id,canonical_json FROM private_owner_location_provenance WHERE property_id ${members} ORDER BY property_id,rowid`,
    ],
    [
      "enrichment",
      `SELECT * EXCLUDE(__rank) FROM (SELECT property_id AS __property_id,*,row_number() OVER(PARTITION BY property_id ORDER BY source_id,native_id,rowid) AS __rank FROM protected_enrichment WHERE property_id ${members}) WHERE __rank<=50 ORDER BY __property_id,source_id,native_id,__rank`,
    ],
    [
      "assessmentCaveats",
      `SELECT property_id AS __property_id,caveat FROM private_assessment_match WHERE property_id ${members} ORDER BY property_id,rowid`,
    ],
    [
      "permits",
      `SELECT * EXCLUDE(__rank) FROM (SELECT property_id AS __property_id,*,row_number() OVER(PARTITION BY property_id ORDER BY id) AS __rank FROM permits WHERE property_id ${members}) WHERE __rank<=${PRIVATE_PERMIT_LIMIT} ORDER BY __property_id,id`,
    ],
    [
      "deedObservations",
      `SELECT property_id AS __property_id,canonical_json FROM private_transfer_observations WHERE property_id ${members} ORDER BY property_id,rowid`,
    ],
  ];
  for (const [field, sql] of queries) {
    const rows = await (
      await connection.run(sql, { ids: JSON.stringify(ids) })
    ).getRowObjectsJson();
    const grouped = new Map<string, Row[]>();
    for (const row of rows) {
      const id = String(row.__property_id);
      if (!result.has(id))
        throw new Error("Unexpected property evidence identity");
      const values = grouped.get(id) ?? [];
      values.push(row);
      grouped.set(id, values);
    }
    for (const [id, rows] of grouped) result.get(id)![field] = rows;
  }
  return result;
}
