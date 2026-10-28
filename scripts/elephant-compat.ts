/** Prepare a bounded, real, local-only pilot directly from capture receipts. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import {
  sha256,
  verifyCapture,
  buildRealGroups,
  type PublicFeature,
  type SourceRequest,
} from "../packages/elephant-compat/src/index.ts";
const args = process.argv.slice(2);
function arg(key: string): string {
  const i = args.indexOf(key);
  assert(i >= 0 && args[i + 1], "Required " + key);
  return args[i + 1]!;
}
const startedAt = new Date().toISOString();
const planPath = path.resolve(arg("--source-plan"));
const ledgerPath = path.resolve(arg("--request-ledger"));
const out = path.resolve(arg("--out"));
const limit = Number(arg("--limit"));
assert(
  Number.isInteger(limit) && limit > 0 && limit <= 1000,
  "Pilot limit 1–1000",
);
assert(
  !(await lstat(out).catch(() => undefined)),
  "Output must be a new directory",
);
type Page = {
  path: string;
  sha256: string;
  index: number;
  records: number;
};
type Layer = {
  source: string;
  oidField: string;
  publicFields: string[];
  count: number;
  complete: boolean;
  geometry: boolean;
  pages: Page[];
  objectIdsPath: string;
};
const planBytes = await readFile(planPath);
const ledgerBytes = await readFile(ledgerPath);
const plan = JSON.parse(planBytes.toString()) as {
  complete: boolean;
  runId: string;
  layers: Record<string, Layer>;
};
const ledger = JSON.parse(ledgerBytes.toString()) as {
  events: {
    purpose: string;
    state: string;
    status: number;
    sha256: string;
    requestUrlSha256: string;
  }[];
};
assert(plan.complete && Object.values(plan.layers).every((l) => l.complete));
const parcelLayer = plan.layers.tax_parcel!;
const addressLayer = plan.layers.site_address!;
async function reader(layer: Layer, key: string) {
  const ids = (
    JSON.parse(await readFile(layer.objectIdsPath, "utf8")) as {
      objectIds: number[];
    }
  ).objectIds.sort((a, b) => a - b);
  assert.equal(ids.length, layer.count);
  return async (page: Page) => {
    const wanted = ids.slice(page.index * 2000, (page.index + 1) * 2000);
    const params = new URLSearchParams({
      f: "json",
      where:
        layer.oidField +
        " >= " +
        wanted[0] +
        " AND " +
        layer.oidField +
        " <= " +
        wanted.at(-1),
      resultRecordCount: "2000",
      outFields: layer.publicFields.join(","),
      returnGeometry: layer.geometry ? "true" : "false",
      orderByFields: layer.oidField + " ASC",
    });
    if (layer.geometry) params.set("outSR", "4326");
    const url = layer.source + "/query?" + params;
    const event = ledger.events.find(
      (event) =>
        event.purpose === key + " page " + page.index &&
        event.state === "complete" &&
        event.status === 200 &&
        event.sha256 === page.sha256,
    );
    assert(event, "Missing successful capture receipt");
    const bytes = await readFile(page.path);
    const result = verifyCapture(
      bytes,
      page.sha256,
      url,
      event.requestUrlSha256,
    );
    assert.equal(result.features.length, wanted.length);
    assert.deepEqual(
      result.features.map((f) => f.attributes[layer.oidField]),
      wanted,
      "Captured native-ID window must match the original census",
    );
    return result;
  };
}
type Candidate = {
  feature: PublicFeature;
  request: SourceRequest;
  responseSha256: string;
};
const candidates = new Map<string, Candidate>();
const readAddress = await reader(addressLayer, "site_address");
for (const page of addressLayer.pages) {
  const captured = await readAddress(page);
  for (const feature of captured.features) {
    const pin = feature.attributes.PIN;
    if (
      typeof pin === "string" &&
      pin.trim() &&
      typeof feature.attributes.SITESTREETADDRESS === "string" &&
      String(feature.attributes.SITESTREETADDRESS).trim() &&
      Number.isFinite(feature.geometry?.x) &&
      Number.isFinite(feature.geometry?.y) &&
      !candidates.has(pin)
    )
      candidates.set(pin, {
        feature,
        request: captured.sourceRequest,
        responseSha256: page.sha256,
      });
    if (candidates.size >= limit * 2) break;
  }
  if (candidates.size >= limit * 2) break;
}
const parcels = new Map<string, Candidate>();
const duplicatePins = new Set<string>();
const readParcel = await reader(parcelLayer, "tax_parcel");
let verifiedParcelRows = 0;
for (const page of parcelLayer.pages) {
  const captured = await readParcel(page);
  verifiedParcelRows += captured.features.length;
  for (const feature of captured.features) {
    const pin = feature.attributes.PIN;
    if (typeof pin !== "string" || !candidates.has(pin)) continue;
    if (parcels.has(pin)) duplicatePins.add(pin);
    else
      parcels.set(pin, {
        feature,
        request: captured.sourceRequest,
        responseSha256: page.sha256,
      });
  }
}
assert.equal(verifiedParcelRows, parcelLayer.count);
const selected = [...parcels.entries()]
  .filter(([pin]) => !duplicatePins.has(pin))
  .slice(0, limit);
assert.equal(selected.length, limit, "Insufficient unambiguous real joins");
await mkdir(out, { recursive: false, mode: 0o700 });
const input = path.join(out, "input");
await mkdir(input, { mode: 0o700 });
const records = [];
for (const [pin, parcel] of selected) {
  const address = candidates.get(pin)!;
  const name = "parcel-native-" + parcel.feature.attributes.OBJECTID_12;
  const directory = path.join(input, name);
  await mkdir(directory, { mode: 0o700 });
  const files = buildRealGroups(
    parcel.feature,
    parcel.request,
    address.feature,
    address.request,
  );
  for (const [file, value] of Object.entries(files))
    await writeFile(path.join(directory, file), JSON.stringify(value) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  records.push({
    directory: name,
    parcelResponseSha256: parcel.responseSha256,
    addressResponseSha256: address.responseSha256,
    sourceRecordDigest: sha256(
      JSON.stringify([parcel.feature, address.feature]),
    ),
  });
}
const receipt = {
  version: "real-capture-elephant-local-pilot-v1",
  runId: plan.runId,
  county: "Oakland",
  state: "MI",
  fips: "26125",
  requestedPilotProperties: limit,
  convertedProperties: selected.length,
  dataGroups: ["Seed", "County"],
  groupsPerProperty: 2,
  filesPerProperty: 7,
  startedAt,
  completedAt: new Date().toISOString(),
  sourcePlanSha256: sha256(planBytes),
  sourceLedgerSha256: sha256(ledgerBytes),
  verifiedParcelRows,
  selectedPinAmbiguitiesExcluded: duplicatePins.size,
  actualCapturedBatchRequestsPreserved: true,
  queryDbExportsUsed: false,
  sourceFactsFabricated: false,
  privateSourceFieldsProjected: false,
  optionalCountyNameOmittedBecauseCurrentEnumExcludesOakland: true,
  workingSourceDataRetained: true,
  selection:
    "First native-ID address candidates, exact unique raw parcel PIN join, one address per selected parcel; bounded pilot, not county completeness",
  records,
};
await writeFile(
  path.join(out, "conversion-receipt.json"),
  JSON.stringify(receipt, null, 2) + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(
  JSON.stringify({
    convertedProperties: selected.length,
    files: selected.length * 7,
    verifiedParcelRows,
    output: out,
    noNewHttpRequests: true,
    actualPropertyValuesPrinted: false,
  }),
);
