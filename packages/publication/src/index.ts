import type { Property } from "../../contracts/src/index.ts";
import { digest } from "../../identity/src/index.ts";
export function dryManifest(snapshotId: string, rows: readonly Property[]) {
  const bytes = JSON.stringify(rows);
  return {
    version: "0.1.0",
    snapshotId,
    mode: "local-dry-run",
    publicationAuthorized: false,
    items: [
      {
        name: "private-working-snapshot.json",
        artifactKind: "file",
        size: Buffer.byteLength(bytes),
        digest: digest(bytes),
        cid: null,
        codec: null,
        eligibility: "pending-exact-byte-rights-approval",
      },
    ],
    car: {
      state: "not-produced",
      reason:
        "Public CAR packing requires live compatible Lexicon validation and a later authorized publication rehearsal",
    },
    ipfs: { state: "not-published", replicas: 0 },
    previousSnapshots: ["demo-oakland-v0"],
    limitations: [
      "Working snapshot is internal, not a CLI-exported public artifact",
      "No CID, gateway or provider status fabricated",
    ],
  };
}
