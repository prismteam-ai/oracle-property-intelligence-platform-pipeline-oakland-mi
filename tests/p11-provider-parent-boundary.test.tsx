import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PermitSchema,
  PropertySchema,
} from "../packages/contracts/src/index.ts";
import { syntheticProperties } from "../packages/test-support/src/fixtures.ts";
import { EvidenceDetails } from "../apps/pipeline-web/src/details.tsx";
import { isRestrictedProviderPermit } from "../apps/pipeline-web/src/source-details.tsx";
import { observation } from "./p6-observations.fixture.ts";

test("provider-only parent fields share the restricted boundary; independently official parent facts stay visible", () => {
  const provider = {
    ...observation(),
    reportedBusinessName: "SYNTHETIC_PROVIDER_PARENT_PARTY",
  };
  const provenance = {
    sourceId: provider.provenance.sourceId,
    recordId: provider.providerRecordId,
    digest: provider.provenance.recordDigest,
    observedAt: provider.sourceObservedAt,
    kind: "real-minimized" as const,
  };
  const parent = PermitSchema.parse({
    id: "no-provider-name-heuristic",
    status: "unknown",
    kind: "roof_unspecified",
    permitNumber: provider.permitNumber,
    jurisdiction: "Troy",
    issuedAt: provider.dateIssued,
    statusBasis: "issued_only",
    openedAt: null,
    closedAt: null,
    contractor: {
      reportedName: provider.reportedBusinessName,
      verifiedCompanyId: null,
      license: null,
      rating: null,
    },
    provenance: [provenance],
    sourceObservations: [provider],
  });
  const property = PropertySchema.parse({
    ...syntheticProperties(1)[0]!,
    id: provider.canonicalPropertyId,
    permits: [parent],
  });
  const html = renderToStaticMarkup(
    <EvidenceDetails
      selected={property}
      health={null}
      result={null}
      binding={null}
      closeEvidence={() => undefined}
    />,
  );
  expect(isRestrictedProviderPermit(parent)).toBe(true);
  expect(html).toMatch(
    /<article class="detail-permit"[^>]*data-private-evidence="provider-derived-permit"/,
  );
  expect(html).toContain("SYNTHETIC_PROVIDER_PARENT_PARTY");
  const official = PermitSchema.parse({
    ...parent,
    contractor: {
      ...parent.contractor,
      reportedName: "SYNTHETIC_OFFICIAL_PARTY",
    },
    provenance: [
      {
        ...provenance,
        sourceId: "official-synthetic-municipal-source",
        recordId: "SYNTHETIC_OFFICIAL_RECORD",
      },
    ],
  });
  expect(isRestrictedProviderPermit(official)).toBe(false);
  const visible = renderToStaticMarkup(
    <EvidenceDetails
      selected={{ ...property, permits: [official] }}
      health={null}
      result={null}
      binding={null}
      closeEvidence={() => undefined}
    />,
  );
  expect(visible).not.toMatch(
    /<article class="detail-permit"[^>]*data-private-evidence="provider-derived-permit"/,
  );
  expect(visible).toContain("SYNTHETIC_OFFICIAL_PARTY");
  expect(visible).toContain("Terms-restricted provider source observation");
});
