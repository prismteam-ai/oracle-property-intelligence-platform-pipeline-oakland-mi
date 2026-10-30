import path from "node:path";
import { buildOfficialPublicationCandidate } from "../packages/publication/src/official-parcel-candidate.ts";
const args = process.argv.slice(2);
if (!args.includes("--execute"))
  console.log(
    JSON.stringify({
      state: "PLAN_ONLY_ZERO_INPUT_READS_OR_EFFECTS",
      uploadAuthorized: false,
    }),
  );
else {
  const arg = (key: string) => {
    const i = args.indexOf(key);
    if (i < 0 || !args[i + 1]) throw new Error("Required " + key);
    return args[i + 1]!;
  };
  console.log(
    JSON.stringify(
      await buildOfficialPublicationCandidate({
        baseDirectory: path.resolve(arg("--base")),
        basePublicationSha256: arg("--base-publication-sha256"),
        officialDirectory: path.resolve(arg("--official")),
        outputDirectory: path.resolve(arg("--out")),
      }),
    ),
  );
}
