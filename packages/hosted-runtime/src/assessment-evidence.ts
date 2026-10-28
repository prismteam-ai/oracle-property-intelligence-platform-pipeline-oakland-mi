import type { RuntimeIdentity } from "./release";
import publication from "./public-run-evidence.json" with { type: "json" };
const measuredHash = (value: string | undefined) =>
  /^[a-f0-9]{64}$/.test(value ?? "") ? value : null;
/** Public reviewer metadata only. Never serialize generic environment or protected records. */
export function assessmentEvidence(
  identity: RuntimeIdentity,
  snapshot: {
    snapshotId: string;
    snapshotDigest?: string;
    publicSnapshotId?: string;
  },
) {
  return {
    version: 1,
    release: {
      ...identity,
      archiveSha256: measuredHash(process.env.PRISM_LAMBDA_ARCHIVE_SHA256),
      frontendAssetManifestSha256: measuredHash(
        process.env.PRISM_FRONTEND_ASSET_MANIFEST_SHA256,
      ),
      frontendAssetManifestPath: "/assessment-asset-manifest.json",
    },
    snapshot,
    publication,
  };
}
