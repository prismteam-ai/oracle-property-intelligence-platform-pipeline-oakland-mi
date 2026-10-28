import {
  rehearsePublication,
  type PublicationProfile,
} from "../packages/publication/src/local.ts";
const args = process.argv.slice(2),
  directory = args.shift() ?? process.env.PRISM_SNAPSHOT_DIR;
if (!directory) throw new Error("Snapshot directory required");
let profile: PublicationProfile = "legacy-data-v1";
let previousPublicationDirectory: string | undefined;
while (args.length) {
  const option = args.shift(),
    value = args.shift();
  if (
    option === "--profile" &&
    value &&
    ["legacy-data-v1", "run-history-v2", "run-history-v3"].includes(value)
  )
    profile = value as PublicationProfile;
  else if (option === "--previous" && value)
    previousPublicationDirectory = value;
  else
    throw new Error(
      "Expected directory [--profile legacy-data-v1|run-history-v2|run-history-v3] [--previous trusted-previous-publication-directory]",
    );
}
const manifest = await rehearsePublication(directory, {
  profile,
  previousPublicationDirectory,
});
console.log(JSON.stringify(manifest, null, 2));
