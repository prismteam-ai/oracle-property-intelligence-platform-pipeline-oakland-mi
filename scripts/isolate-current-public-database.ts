import { rebuildCurrentPublicDatabaseIsolated } from "../packages/publication/src/current-public-isolation.ts";
const args = process.argv.slice(2);
function argument(name: string) {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) throw new Error("Required " + name);
  return args[i + 1]!;
}
if (!args.includes("--execute"))
  console.log(JSON.stringify({ state: "PLAN_ONLY", publicationEffects: 0 }));
else
  console.log(
    JSON.stringify(
      await rebuildCurrentPublicDatabaseIsolated({
        directory: argument("--directory"),
        indexSha256: argument("--index-sha256"),
        outputDirectory: argument("--output-directory"),
      }),
    ),
  );
