import { readFile } from "node:fs/promises";
import path from "node:path";
import { exportOfficialParcelCandidate } from "../packages/county/src/official-parcel-export.ts";
import type { OfficialParcelProfileEnvelope } from "../packages/county/src/official-parcel.ts";
import type { FullSourceConfig } from "../packages/county/src/private-full-source.ts";
import { sha256 } from "../packages/county/src/model.ts";
const args = process.argv.slice(2);
if (!args.includes("--execute")) {
  console.log(
    JSON.stringify({
      state: "PLAN_ONLY_ZERO_INPUT_READS_OR_EFFECTS",
      uploadAuthorized: false,
      required: ["--source-config", "--profile", "--profile-sha256", "--out"],
    }),
  );
} else {
  const arg = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error("Required " + name);
    return args[index + 1]!;
  };
  const source = await readFile(path.resolve(arg("--source-config")));
  const profile = await readFile(path.resolve(arg("--profile")));
  if (
    source.length > 1024 ** 2 ||
    profile.length > 1024 ** 2 ||
    sha256(profile) !== arg("--profile-sha256")
  )
    throw new Error("Bounded exact source/profile metadata required");
  const manifest = await exportOfficialParcelCandidate({
    source: JSON.parse(source.toString()) as FullSourceConfig,
    profile: JSON.parse(profile.toString()) as OfficialParcelProfileEnvelope,
    outputDir: path.resolve(arg("--out")),
  });
  console.log(JSON.stringify(manifest));
}
