import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PermitOpportunityBadges } from "../apps/pipeline-web/src/permit-opportunities.tsx";
import {
  ProviderPermitObservationSchema,
  type Permit,
  type QueryInput,
} from "../packages/contracts/src/index.ts";
import {
  syntheticProperties,
  SNAPSHOT_ID,
} from "../packages/test-support/src/fixtures.ts";
import { observation } from "./p6-observations.fixture.ts";

it("mixed-source badge masking follows only the actually displayed qualifying observation", () => {
  const property = structuredClone(syntheticProperties()[0]!);
  const provider = ProviderPermitObservationSchema.parse({
    ...observation(),
    canonicalPropertyId: property.id,
    publicSnapshotId: SNAPSHOT_ID,
  });
  const native: Permit = {
    id: "native",
    kind: "roof_repair",
    status: "unknown",
    statusBasis: "issued_only",
    reportedStatus: null,
    issuedAt: "2018-01-01",
    openedAt: null,
    closedAt: null,
    contractor: {
      reportedName: null,
      verifiedCompanyId: null,
      license: null,
      rating: null,
    },
    provenance: [
      {
        sourceId: "official-troy-issued-permits",
        recordId: "native-record",
        digest: "a".repeat(64),
        observedAt: "2026-10-28T00:00:00Z",
        kind: "real-public",
      },
    ],
  };
  property.permits = [
    native,
    {
      ...native,
      id: "provider-parent",
      kind: "other",
      provenance: [],
      sourceObservations: [provider],
    },
  ];
  const query: QueryInput = {
    snapshotId: SNAPSHOT_ID,
    lat: 42.66,
    lng: -83.29,
    radiusMeters: 8046.72,
    permitOpportunityMode: "status_verification_needed",
    minPermitObservationAgeYears: 5,
  };
  const providerFirst = renderToStaticMarkup(
    <PermitOpportunityBadges property={property} query={query} />,
  );
  expect(providerFirst).toContain(
    'data-private-evidence="provider-derived-permit-evidence"',
  );
  expect(providerFirst).toContain("2016-10-28");
  native.issuedAt = "2010-01-01";
  const nativeFirst = renderToStaticMarkup(
    <PermitOpportunityBadges property={property} query={query} />,
  );
  expect(nativeFirst).toContain("2010-01-01");
  expect(nativeFirst).not.toContain("data-private-evidence");
});
