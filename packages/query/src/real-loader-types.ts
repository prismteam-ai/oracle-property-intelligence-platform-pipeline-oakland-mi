import type { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";
import type { Permit } from "../../contracts/src/index.ts";
import type { ArtifactManifest } from "../../county/src/build.ts";
import type {
  FullSourceConfig,
  FullSourceAudit,
} from "../../county/src/private-full-source.ts";
export interface SnapshotOpenOptions {
  protectedProviderObservationsFile?: string;
  protectedProviderObservationsSha256?: string;
  protectedTransferObservationsFile?: string;
  protectedTransferObservationsSha256?: string;
  protectedSourceRunsFile?: string;
  protectedSourceRunsSha256?: string;
  protectedDerivativeFile?: string;
  protectedDerivativeSha256?: string;
  protectedEnrichmentFile?: string;
  protectedEnrichmentSha256?: string;
  protectedPermitsFile?: string;
  protectedPermitsSha256?: string;
  protectedSourceIntakeFile?: string;
  protectedSourceIntakeSha256?: string;
  protectedFullSources?: readonly FullSourceConfig[];
}
export interface ProtectedPermitProjection {
  row: {
    property_id: string | null;
    source_id: string;
    native_id: string;
    record_digest: string;
    observed_at: string;
  };
  permit: Permit;
  openDays: number | null;
}
export type SnapshotConstructionArguments = [
  manifest: ArtifactManifest,
  connection: DuckDBConnection,
  instance: DuckDBInstance,
  coverage: unknown,
  runs: unknown[],
  ownerSignalsAvailable: boolean,
  overlayDigests: readonly string[],
  permitCount: number,
  permitSourceCounts: Record<string, number>,
  sourceIntakeCount: number,
  fullSourceAudits: FullSourceAudit[],
  sourceObservationAudit: import("./real-source-observations.ts").SourceObservationAudit,
  temporaryDirectory: string,
];
