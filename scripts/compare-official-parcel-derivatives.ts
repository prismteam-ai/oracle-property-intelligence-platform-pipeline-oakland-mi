import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareOfficialOwnerDerivatives } from "../packages/county/src/official-parcel-derivatives.ts";
import type { FullSourceConfig } from "../packages/county/src/private-full-source.ts";
const args = process.argv.slice(2);
if (!args.includes("--execute"))
  console.log(
    JSON.stringify({
      state: "PLAN_ONLY_ZERO_INPUT_READS_OR_EFFECTS",
      required: [
        "--source-config",
        "--owner-file",
        "--owner-sha256",
        "--snapshot",
        "--out",
      ],
    }),
  );
else {
  const arg = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0 || !args[i + 1]) throw new Error("Required " + name);
    return args[i + 1]!;
  };
  const metadata = await readFile(path.resolve(arg("--source-config")));
  if (metadata.length > 1024 ** 2) throw new Error("Bounded metadata required");
  const result = await compareOfficialOwnerDerivatives({
    source: JSON.parse(metadata.toString()) as FullSourceConfig,
    ownerFile: path.resolve(arg("--owner-file")),
    ownerSha256: arg("--owner-sha256"),
    publicSnapshotId: arg("--snapshot"),
  });
  await writeFile(
    path.resolve(arg("--out")),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify(result));
  if (result.status !== "PASS_ALL_RETAINED_POSTAL_DERIVATIVES_MATCH")
    process.exitCode = 2;
}
