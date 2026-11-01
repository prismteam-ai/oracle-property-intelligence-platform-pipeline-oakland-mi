import {
  fetchCurrentPublicDatabase,
  queryCurrentPublicDatabase,
} from "../packages/publication/src/current-public-consumer.ts";
const args = process.argv.slice(2);
function argument(name: string) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error("Required " + name);
  return args[index + 1]!;
}
if (!args.includes("--execute"))
  console.log(
    JSON.stringify({
      state: "PLAN_ONLY",
      oracleApiRequired: false,
      awsCredentialsRequired: false,
    }),
  );
else {
  const directory = argument("--directory");
  if (args.includes("--index-url"))
    console.log(
      JSON.stringify({
        publicDownload: await fetchCurrentPublicDatabase({
          indexUrl: argument("--index-url"),
          indexSha256: argument("--index-sha256"),
          outputDirectory: directory,
        }),
      }),
    );
  console.log(JSON.stringify(await queryCurrentPublicDatabase(directory)));
}
