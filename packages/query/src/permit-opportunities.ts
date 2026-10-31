/** Read-only derived query bindings. Source JSON is immutable; selection precedes SQL pagination. */
import type { DuckDBConnection } from "@duckdb/node-api";
import {
  DomainError,
  PermitSchema,
  type Permit,
  type Query,
} from "../../contracts/src/index.ts";
import {
  qualifyingPermitObservationSignals,
  signalConfidenceRank,
} from "../../contracts/src/query-predicates.ts";

type Row = { propertyId: string; permit: Permit };
const cache = new WeakMap<DuckDBConnection, Promise<readonly Row[]>>();
function records(connection: DuckDBConnection): Promise<readonly Row[]> {
  let found = cache.get(connection);
  if (!found) {
    found = (async () => {
      const rows = await (
        await connection.run("SELECT * FROM permits")
      ).getRowObjectsJson();
      if (rows.length > 200000)
        throw new DomainError(
          "COST_LIMIT_REACHED",
          "Permit observation query bound exceeded",
        );
      return rows.map((row) => ({
        propertyId: String(row.property_id),
        permit: PermitSchema.parse(
          row.canonical_json
            ? JSON.parse(String(row.canonical_json))
            : {
                id: String(row.id),
                status: String(row.status),
                kind: String(row.kind),
                openedAt: row.opened_at ?? null,
                closedAt: row.closed_at ?? null,
                contractor: {
                  reportedName: row.reported_contractor ?? null,
                  verifiedCompanyId: row.verified_company_id ?? null,
                  license: row.license ?? null,
                  rating: row.rating ?? null,
                },
                provenance:
                  row.source_id &&
                  row.native_id &&
                  row.observed_at &&
                  row.receipt_digest
                    ? [
                        {
                          sourceId: String(row.source_id),
                          recordId: String(row.native_id),
                          observedAt: String(row.observed_at),
                          digest: String(row.receipt_digest),
                          kind: "real-minimized",
                        },
                      ]
                    : [],
              },
        ),
      }));
    })();
    cache.set(connection, found);
  }
  return found;
}
export async function permitOpportunityBindings(
  connection: DuckDBConnection,
  query: Query,
) {
  const selected: {
    permitId: string;
    propertyId: string;
    ageDays: number;
    confidenceRank: number;
    openDays: number;
    propertyAgeDays?: number;
    propertyConfidenceRank?: number;
    propertyOpenDays?: number;
  }[] = [];
  if (query.permitOpportunityMode) {
    for (const { propertyId, permit } of await records(connection)) {
      const signals = qualifyingPermitObservationSignals(
        permit,
        query,
        permit.statusObservedAt?.slice(0, 10) ??
          permit.provenance[0]?.observedAt.slice(0, 10) ??
          "",
      );
      if (signals.length)
        selected.push({
          permitId: permit.id,
          propertyId,
          ageDays: signals[0]!.ageDays ?? -1,
          confidenceRank: signalConfidenceRank(signals[0]!),
          openDays: Math.max(-1, ...signals.map((s) => s.openDays ?? -1)),
        });
    }
    const priorities = new Map<
      string,
      { ageDays: number; confidenceRank: number }
    >();
    const openPriorities = new Map<string, number>();
    for (const row of selected) {
      openPriorities.set(
        row.propertyId,
        Math.max(openPriorities.get(row.propertyId) ?? -1, row.openDays),
      );
      const old = priorities.get(row.propertyId);
      if (
        !old ||
        row.ageDays > old.ageDays ||
        (row.ageDays === old.ageDays && row.confidenceRank > old.confidenceRank)
      )
        priorities.set(row.propertyId, row);
    }
    for (const row of selected) {
      const best = priorities.get(row.propertyId)!;
      row.propertyAgeDays = best.ageDays;
      row.propertyConfidenceRank = best.confidenceRank;
      row.propertyOpenDays = openPriorities.get(row.propertyId);
    }
  }
  return {
    opportunityMode: query.permitOpportunityMode ?? null,
    opportunityMatches: JSON.stringify(selected),
    sortIssueAge:
      query.sort === "permit_issue_age_desc" ||
      (!query.sort &&
        query.permitOpportunityMode === "status_verification_needed"),
  };
}
export const OPPORTUNITY_CTE = `opportunity_properties AS (SELECT json_extract_string(value,'$.propertyId') AS property_id,max(CAST(json_extract(value,'$.propertyAgeDays') AS INTEGER)) AS issue_age,max(CAST(json_extract(value,'$.propertyConfidenceRank') AS INTEGER)) AS issue_confidence,max(CAST(json_extract(value,'$.propertyOpenDays') AS INTEGER)) AS open_days FROM json_each($opportunityMatches) GROUP BY property_id)`;
export const OPPORTUNITY_FILTER_SQL = `AND (CAST($opportunityMode AS VARCHAR) IS NULL OR EXISTS(SELECT 1 FROM json_each($opportunityMatches) oq WHERE json_extract_string(oq.value,'$.permitId')=x.id AND json_extract_string(oq.value,'$.propertyId')=x.property_id))`;

export const OPPORTUNITY_MATCH_SQL = `EXISTS(SELECT 1 FROM json_each($opportunityMatches) oq WHERE json_extract_string(oq.value,'$.permitId')=x.id AND json_extract_string(oq.value,'$.propertyId')=x.property_id)`;
