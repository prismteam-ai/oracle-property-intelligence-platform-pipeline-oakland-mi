import {
  rehearsePublication,
  type PublicationProfile,
} from "../packages/publication/src/local.ts";
const args = process.argv.slice(2),
  directory = args.shift() ?? process.env.PRISM_SNAPSHOT_DIR;
if (!directory) throw new Error("Snapshot directory required");
let profile: PublicationProfile = "legacy-data-v1";
if (args.length) {
  if (
    args.length !== 2 ||
    args[0] !== "--profile" ||
    !["legacy-data-v1", "run-history-v2"].includes(args[1]!)
  )
    throw new Error(
      "Expected directory [--profile legacy-data-v1|run-history-v2]",
    );
  profile = args[1] as PublicationProfile;
}
const manifest = await rehearsePublication(directory, { profile });
console.log(JSON.stringify(manifest, null, 2));
