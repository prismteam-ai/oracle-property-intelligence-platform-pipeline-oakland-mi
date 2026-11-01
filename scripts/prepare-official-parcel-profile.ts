/** Root-run metadata-only preparation. No requests, source rows or upload. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createOfficialParcelProfile,
  type OfficialFieldCensus,
} from "../packages/county/src/official-parcel.ts";
import type { FullSourceConfig } from "../packages/county/src/private-full-source.ts";
import { sha256, stableJson } from "../packages/county/src/model.ts";

const args = process.argv.slice(2);
if (!args.includes("--execute")) {
  console.log(
    JSON.stringify({
      state: "PLAN_ONLY_ZERO_INPUT_READS_OR_EFFECTS",
      required: [
        "--source-config",
        "--snapshot",
        "--census",
        "--census-sha256",
        "--terms-url",
        "--terms-sha256",
        "--out",
      ],
    }),
  );
} else {
  const arg = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error("Required " + name);
    return args[index + 1]!;
  };
  const censusBytes = await readFile(path.resolve(arg("--census")));
  if (
    censusBytes.length > 1024 ** 2 ||
    sha256(censusBytes) !== arg("--census-sha256")
  )
    throw new Error("Exact bounded census receipt required");
  const sourceBytes = await readFile(path.resolve(arg("--source-config")));
  if (sourceBytes.length > 1024 ** 2) throw new Error("Source metadata bound");
  const source = JSON.parse(sourceBytes.toString()) as FullSourceConfig;
  const profile = createOfficialParcelProfile({
    source,
    publicSnapshotId: arg("--snapshot"),
    census: JSON.parse(censusBytes.toString()) as OfficialFieldCensus,
    censusSha256: arg("--census-sha256"),
    termsUrl: arg("--terms-url"),
    termsSha256: arg("--terms-sha256"),
  });
  const bytes = stableJson(profile) + "\n";
  await writeFile(path.resolve(arg("--out")), bytes, {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      state: "OFFICIAL_PARCEL_PROFILE_PREPARED_ONLY",
      sha256: sha256(bytes),
      retainedRows: source.sourceRecordCount,
      currentCensusRows: profile.availability.currentParcelRows,
      uploadAuthorized: false,
    }),
  );
}
