import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { DuckDBInstance } from "@duckdb/node-api";
import { RealSnapshot } from "../packages/query/src/real.ts";
import { distanceMeters } from "../packages/query/src/index.ts";
import { sha256 } from "../packages/county/src/model.ts";
const [directory, ownerFile, enrichmentFile, output] = process.argv.slice(2);
if (!directory || !ownerFile || !enrichmentFile || !output)
  throw new Error(
    "Expected public directory, protected owner file, protected enrichment file, safe summary output",
  );
const publicReader = await RealSnapshot.open(directory),
  privateReader = await RealSnapshot.open(directory, {
    protectedDerivativeFile: ownerFile,
    protectedDerivativeSha256: sha256(await readFile(ownerFile)),
    protectedEnrichmentFile: enrichmentFile,
    protectedEnrichmentSha256: sha256(await readFile(enrichmentFile)),
  });
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const instance = await DuckDBInstance.create(":memory:");
const db = await instance.connect();
try {
  const base = {
    snapshotId: publicReader.snapshotId,
    lat: 42.66,
    lng: -83.29,
    radiusMeters: 8046.72,
    limit: 50,
  };
  const radius = await publicReader.search(base);
  if (
    !radius.rows.length ||
    radius.rows.some(
      (p) =>
        !p.coordinates ||
        distanceMeters(
          base.lat,
          base.lng,
          p.coordinates.lat,
          p.coordinates.lng,
        ) > base.radiusMeters,
    )
  )
    throw new Error("Real radius predicate failed");
  if (
    radius.rows.some(
      (p) =>
        p.roof.ageYears !== null ||
        p.ownership.ownerRegion !== "unknown" ||
        p.ownership.events?.length,
    )
  )
    throw new Error("Protected evidence leaked into public reader");
  const noPermits = await publicReader.search({
    ...base,
    permitStatus: "open",
    minOpenDays: 1827,
  });
  if (noPermits.total !== 0)
    throw new Error("Unexpected public roofing evidence");
  await db.run(
    `CREATE TABLE p AS SELECT id,pin FROM read_parquet(${quote(path.join(directory, "parcels.parquet"))})`,
  );
  await db.run(
    `CREATE TABLE a AS SELECT id,pin,lat,lng FROM read_parquet(${quote(path.join(directory, "site-addresses.parquet"))})`,
  );
  await db.run(
    `CREATE TABLE e AS SELECT * FROM read_parquet(${quote(enrichmentFile)})`,
  );
  await db.run(
    `CREATE TABLE o AS SELECT * FROM read_parquet(${quote(ownerFile)})`,
  );
  const facts = (
    await (
      await db.run(
        "SELECT (SELECT count(*) FROM p)::INTEGER AS parcels,(SELECT count(*) FROM a)::INTEGER AS addresses,(SELECT count(*) FROM a WHERE lat IS NULL OR lng IS NULL)::INTEGER AS unknown_coordinates,(SELECT count(*) FROM o)::INTEGER AS owner_observations,(SELECT count(*) FROM e)::INTEGER AS matched_enrichment_associations,(SELECT count(DISTINCT property_id) FROM e)::INTEGER AS enriched_properties,(SELECT count(DISTINCT property_id) FROM e WHERE built_year IS NOT NULL)::INTEGER AS built_year_properties",
      )
    ).getRowObjectsJson()
  )[0]!;
  const publicColumns = [];
  for (const f of [
    "parcels.parquet",
    "site-addresses.parquet",
    "parcel-address-links.parquet",
    "permits.parquet",
  ]) {
    const columns = await (
      await db.run(
        `DESCRIBE SELECT * FROM read_parquet(${quote(path.join(directory, f))})`,
      )
    ).getRowObjectsJson();
    const names = columns.map((c) => String(c.column_name));
    if (
      names.some((n) =>
        /^(NAME1|NAME2|POSTALADDRESS|phone|email|owner_name)$/i.test(n),
      )
    )
      throw new Error("Forbidden public column");
    publicColumns.push({ file: f, columns: names });
  }
  const evidenceRows = await (
    await db.run(
      "SELECT e.property_id,a.lat,a.lng FROM e JOIN p ON p.id=e.property_id JOIN a ON a.pin=p.pin WHERE e.built_year IS NOT NULL AND a.lat IS NOT NULL ORDER BY e.property_id LIMIT 1",
    )
  ).getRowObjectsJson();
  if (!evidenceRows[0])
    throw new Error("No legitimate matched roof proxy with a point");
  const location = evidenceRows[0];
  const privateQuery = {
    snapshotId: privateReader.snapshotId,
    lat: Number(location.lat),
    lng: Number(location.lng),
    radiusMeters: 8046.72,
    limit: 100,
    roofMinAgeYears: 15,
    minConfidence: "low",
  };
  const roofs = await privateReader.search(privateQuery);
  if (
    !roofs.rows.length ||
    roofs.rows.some(
      (p) =>
        p.roof.ageYears === null ||
        p.roof.ageYears <= 15 ||
        p.roof.basis !== "built_year" ||
        !p.roof.provenance?.length,
    )
  )
    throw new Error("Actual protected roof proxy predicate/grounding failed");
  const detail = await privateReader.detail(
    String(location.property_id),
    privateReader.snapshotId,
  );
  if (
    !detail.ownership.events?.some((e) => e.kind === "reported_sale") ||
    detail.ownership.lastTransferDate !== null ||
    detail.ownership.historyCoverage !== "partial"
  )
    throw new Error("Reported sale/unknown tenure semantics failed");
  let tenureRejected = false;
  try {
    await privateReader.search({ ...privateQuery, minOwnershipYears: 10 });
  } catch {
    tenureRejected = true;
  }
  if (!tenureRejected)
    throw new Error("Partial sale history was treated as tenure proof");
  const ownerResults = await privateReader.search({
    snapshotId: privateReader.snapshotId,
    lat: 42.66,
    lng: -83.29,
    radiusMeters: 8046.72,
    limit: 50,
    ownerRegion: "out_of_area",
  });
  if (
    ownerResults.rows.some(
      (p) =>
        p.ownership.ownerRegion !== "out_of_area" ||
        p.ownership.locationClass !== "out_of_state",
    )
  )
    throw new Error("Source-backed postal-state derivative failed");
  let mixedViewRejected = false;
  try {
    await privateReader.search({
      ...base,
      cursor: radius.nextCursor ?? undefined,
    });
  } catch {
    mixedViewRejected = true;
  }
  if (!mixedViewRejected)
    throw new Error("Public/protected view identity crossed");
  const summary = {
    kind: "actual-complete-real-and-protected-vertical-proof",
    generatedUtc: new Date().toISOString(),
    publicSnapshotId: publicReader.snapshotId,
    publicDigest: publicReader.digest,
    protectedViewId: privateReader.snapshotId,
    protectedViewDigest: privateReader.digest,
    counts: facts,
    publicRadius: {
      total: radius.total,
      returned: radius.rows.length,
      everyDistanceWithinRadius: true,
    },
    publicRoofPermitOwnerUnknown: true,
    publicPermitSearch: {
      qualifyingMatches: 0,
      coverage: "unknown_not_zero_permit_population",
    },
    privateRoofProxy: {
      qualifyingMatches: roofs.total,
      returned: roofs.rows.length,
      everyRowSourceBackedBuiltYearLowConfidence: true,
    },
    privatePostalState: {
      qualifyingMatches: ownerResults.total,
      returned: ownerResults.rows.length,
      everyReturnedOutOfState: true,
      knownSourceMatchesAvailable: ownerResults.total > 0,
      interpretation: ownerResults.total
        ? "Source-backed mailing-state observations"
        : "No qualifying full state/ZIP owner observations in selected source; unknown is not a local-owner assertion",
    },
    reportedSalesRemainPartial: true,
    tenYearTenureRejected: true,
    mixedPublicProtectedViewRejected: true,
    publicColumns,
    rawPrivateValuesReturned: false,
    privateRecordRowsReturned: false,
    networkUsed: false,
    limitations: [
      "Protected source observations and owner-derived rows are not in this summary or the return artifacts.",
      "Assessor built year is a low-confidence roof proxy; partial reported sales do not prove tenure.",
      "No actual roofing permit/license/rating fact is invented.",
    ],
  };
  await writeFile(output, JSON.stringify(summary, null, 2) + "\n");
  console.log(
    JSON.stringify({
      status: "PASS",
      publicSnapshotId: publicReader.snapshotId,
      canonicalProperties: publicReader.count,
      roofProxyMatches: roofs.total,
      ownerDerivedMatches: ownerResults.total,
      privateValuesPrinted: false,
      output,
    }),
  );
} finally {
  publicReader.close();
  privateReader.close();
  db.closeSync();
  instance.closeSync();
}
