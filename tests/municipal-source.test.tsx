import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isMunicipalReportSourceId,
  sourceContext,
} from "../packages/hosted-runtime/src/source-context.ts";
import { syntheticProperties } from "../packages/test-support/src/fixtures.ts";
import { EvidenceDetails } from "../apps/pipeline-web/src/details.tsx";
import { MunicipalSource } from "../apps/pipeline-web/src/municipal-source.tsx";
import { loadMunicipalReportContext } from "../apps/pipeline-web/src/municipal-source-loader.ts";

test("Troy assessor provenance stays visible without mounting or fetching PDF report context", async () => {
  const sourceId = "official-troy-real-property-assessing-ui";
  const provenance = {
    sourceId,
    recordId: "SYNTHETIC-TROY-ASSESSOR-RECORD",
    observedAt: "2026-10-30T00:00:00.000Z",
    digest: "synthetic-troy-record-digest",
    kind: "real-minimized" as const,
  };
  const transport = vi.fn();
  expect(isMunicipalReportSourceId(sourceId)).toBe(false);
  expect(
    await loadMunicipalReportContext(
      sourceId,
      provenance.recordId,
      new AbortController().signal,
      transport,
    ),
  ).toBeNull();
  expect(transport).not.toHaveBeenCalled();
  expect(
    renderToStaticMarkup(
      <MunicipalSource sourceId={sourceId} recordId={provenance.recordId} />,
    ),
  ).toBe("");

  const selected = syntheticProperties(1)[0]!;
  selected.roof.provenance = [provenance];
  const html = renderToStaticMarkup(
    <EvidenceDetails
      selected={selected}
      health={{
        snapshotId: "synthetic-troy-detail",
        snapshotDigest: "synthetic-digest",
        buildId: "synthetic-build",
        mode: "real",
        count: 1,
        accessMode: "review",
        dataMode: "protected-real",
      }}
      result={null}
      binding={null}
      closeEvidence={() => undefined}
    />,
  );
  for (const fact of [
    sourceId,
    provenance.recordId,
    provenance.observedAt,
    provenance.digest,
  ])
    expect(html).toContain(fact);
  expect(html).not.toContain("Loading report context");
  expect(html).not.toContain("Report context unavailable");
});

test.each([
  [
    "official-novi-residential-sales-pdf",
    "RESIDENTIAL NON-CONDO 401 SALES",
    "2026-10-27T08:17:03.790110+00:00",
  ],
  [
    "official-auburn-hills-residential-sales-pdf",
    "Sales Data",
    "2026-10-27T08:17:03.585039+00:00",
  ],
])(
  "registered PDF %s still requests its exact page and retains report metadata",
  async (sourceId, title, observedAt) => {
    const context = sourceContext(sourceId, 2)!;
    const transport = vi.fn(async () => ({ source: context }));
    const signal = new AbortController().signal;
    expect(isMunicipalReportSourceId(sourceId)).toBe(true);
    const result = await loadMunicipalReportContext(
      sourceId,
      "SYNTHETIC:page:2:row:1",
      signal,
      transport,
    );
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      `source-context?sourceId=${sourceId}&page=2`,
      signal,
    );
    expect(result).toMatchObject({
      sourceId,
      visibleTitle: title,
      sourceObservedAt: observedAt,
      declaredReportPeriod: null,
      page: 2,
      partialHistory: true,
      semanticBasis: "building_year_proxy",
      tenYearTenureInference: false,
    });
    expect(result?.pageUrl).toBe(`${context.officialReportUrl}#page=2`);
    expect(result?.caveats.join(" ")).toContain(
      "Historical publication scope only",
    );
    expect(result?.caveats.join(" ")).toContain(
      "source-specific eligibility decision and exact-byte approval",
    );
    expect(result?.caveats.join(" ")).not.toContain(
      "remain excluded from public artifacts",
    );
  },
);

test("unregistered lookalikes and invalid report pages never dispatch context requests", async () => {
  const transport = vi.fn();
  for (const [sourceId, recordId] of [
    ["official-novi-residential-sales-pdf-extra", "record:page:2"],
    ["__proto__", "record:page:2"],
    ["official-novi-residential-sales-pdf", "record:page:19"],
  ])
    expect(
      await loadMunicipalReportContext(
        sourceId!,
        recordId!,
        new AbortController().signal,
        transport,
      ),
    ).toBeNull();
  expect(transport).not.toHaveBeenCalled();
});
