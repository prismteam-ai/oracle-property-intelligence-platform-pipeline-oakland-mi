import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CONTRACT_VERSION } from "../packages/contracts/src/index.ts";
import { projectOfficialParcelObservation } from "../packages/county/src/official-parcel.ts";
import { sha256 } from "../packages/county/src/model.ts";
import {
  officialProfileFixture,
  observedAt,
} from "./official-parcel.fixture.ts";
import {
  syntheticProperties,
  SNAPSHOT_ID,
} from "../packages/test-support/src/fixtures.ts";
import { SnapshotReader } from "../packages/query/src/index.ts";
import { createMcpServer } from "../packages/mcp-adapter/src/server.ts";
import { createApi } from "../apps/api/src/handler.ts";
import {
  AccessService,
  accessCodeDigest,
} from "../packages/hosted-runtime/src/access.ts";
import { MemoryQuotaStore } from "../packages/hosted-runtime/src/quota.ts";
import { MemorySessionStore } from "../packages/hosted-runtime/src/sessions.ts";
import { EvidenceDetails } from "../apps/pipeline-web/src/details.tsx";

test("permitted official observation survives actual API, MCP and React rendering without private masking", async () => {
  const property = syntheticProperties()[0]!;
  property.id = "oakland-parcel-1";
  const raw = JSON.stringify({
    OBJECTID_12: 1,
    PIN: "SYNTHETIC-PIN",
    NAME1: null,
    NAME2: null,
    POSTALADDRESS: "SYNTHETIC OBSERVED MAIL MI 00000",
  });
  property.ownership.officialParcelObservation =
    projectOfficialParcelObservation(
      {
        property_id: property.id,
        native_id: "1",
        source_record_json: raw,
        record_digest: sha256(raw),
        observed_at: observedAt,
      },
      officialProfileFixture(),
    );
  const reader = new SnapshotReader(SNAPSHOT_ID, [property]);
  const snapshot = {
    snapshotId: SNAPSHOT_ID,
    mode: "synthetic" as const,
    digest: sha256("synthetic snapshot"),
    count: 1,
    search: async (q: unknown) => reader.search(q),
    detail: async (id: string, s: string) => reader.detail(id, s),
    coverage: [],
    runs: [],
    manifest: {},
    close() {},
  };
  const api = createApi({
    snapshot,
    local: true,
    access: async () =>
      new AccessService({
        signingKey: "synthetic-only-signing-key-".repeat(2),
        reviewCodeDigest: accessCodeDigest("synthetic-only"),
        keyVersion: "test",
      }),
    quota: new MemoryQuotaStore(),
    sessions: new MemorySessionStore(),
  });
  const response = await api({
    method: "GET",
    path: `/api/properties/${property.id}?snapshotId=${SNAPSHOT_ID}`,
    headers: {},
  });
  expect(response.statusCode).toBe(200);
  expect(
    JSON.parse(response.body).ownership.officialParcelObservation
      .postalAddressAsObserved,
  ).toBe("SYNTHETIC OBSERVED MAIL MI 00000");
  const server = createMcpServer(snapshot);
  const client = new Client({
    name: "official-parcel-observation-test",
    version: CONTRACT_VERSION,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const result = await client.callTool({
      name: "property_evidence",
      arguments: { snapshotId: SNAPSHOT_ID, id: property.id },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain(
      "SYNTHETIC OBSERVED MAIL MI 00000",
    );
  } finally {
    await client.close();
    await server.close();
  }
  const markup = renderToStaticMarkup(
    createElement(EvidenceDetails, {
      selected: property,
      health: null,
      result: null,
      binding: null,
      closeEvidence: () => {},
    }),
  );
  expect(markup).toContain("SYNTHETIC OBSERVED MAIL MI 00000");
  expect(markup).toContain('data-source-classification="official_public"');
  expect(markup).not.toContain("private-protected-evidence");
  expect(markup).not.toContain("synthetic-only-signing-key");
  expect(markup).toContain("observed_null_or_empty");
});

test("the UI labels selected assessor location separately from an independent county postal observation", () => {
  const property = syntheticProperties()[0]!;
  property.id = "oakland-parcel-1";
  const raw = JSON.stringify({
    OBJECTID_12: 1,
    NAME1: null,
    NAME2: null,
    POSTALADDRESS: null,
  });
  property.ownership.officialParcelObservation =
    projectOfficialParcelObservation(
      {
        property_id: property.id,
        native_id: "1",
        source_record_json: raw,
        record_digest: sha256(raw),
        observed_at: observedAt,
      },
      officialProfileFixture(),
    );
  Object.assign(property.ownership, {
    ownerRegion: "regional",
    locationClass: "in_state",
    observedAt: "2026-10-28T08:23:19.029Z",
    locationProvenance: [
      {
        sourceId: "official-troy-real-property-assessing-ui",
        recordId: "SYNTHETIC_ASSESSMENT_ONLY",
        observedAt: "2026-10-28T08:23:19.029Z",
        digest: sha256("synthetic assessment proof"),
        kind: "real-minimized",
      },
    ],
  });
  const markup = renderToStaticMarkup(
    createElement(EvidenceDetails, {
      selected: property,
      health: null,
      result: null,
      binding: null,
      closeEvidence: () => {},
    }),
  );
  const selected = markup.slice(
    markup.indexOf("Selected owner-location evidence"),
    markup.indexOf("Official parcel ownership and mailing observation"),
  );
  const county = markup.slice(
    markup.indexOf("Official parcel ownership and mailing observation"),
  );
  expect(selected).toContain("regional");
  expect(selected).toContain("official-troy-real-property-assessing-ui");
  expect(selected).toContain("2026-10-28T08:23:19.029Z");
  expect(selected).toContain(
    "separate county observation retains its own basis",
  );
  expect(
    markup.match(/class="notice compact official-parcel-observation"/g),
  ).toHaveLength(1);
  expect(county).toContain("unknown");
  expect(county).toContain("derived from this exact postal observation");
  expect(county).toContain(observedAt);
});
