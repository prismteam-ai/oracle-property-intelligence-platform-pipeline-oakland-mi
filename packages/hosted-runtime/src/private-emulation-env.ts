import path from "node:path";
import type { PrivateManifest } from "./private-cache.ts";
import {
  FULL_SOURCE_DEFINITIONS,
  parseFullSourceConfigs,
  type FullSourceRole,
  type FullSourceConfig,
} from "../../county/src/private-full-source.ts";
/** Explicit role mapping for a fresh network-disabled emulator container. */
export function privateEmulationEnvironment(
  manifest: PrivateManifest,
  directory = "/protected",
) {
  const variables = {
    owner: "PRISM_OWNER_DERIVATIVES",
    enrichment: "PRISM_PRIVATE_ENRICHMENT",
    permits: "PRISM_PRIVATE_PERMITS",
    "source-intake": "PRISM_PRIVATE_SOURCE_INTAKE",
    "provider-permit-observations": "PRISM_PRIVATE_PROVIDER_OBSERVATIONS",
    "recorded-transfer-observations": "PRISM_PRIVATE_TRANSFER_OBSERVATIONS",
    "private-source-runs": "PRISM_PRIVATE_SOURCE_RUNS",
    "official-parcel-profile": "PRISM_OFFICIAL_PARCEL_PROFILE",
  } as const;
  const env: Record<string, string> = {},
    full: FullSourceConfig[] = [];
  for (const f of manifest.files) {
    const file = path.posix.join(directory, f.name);
    if (Object.hasOwn(variables, f.role)) {
      const name = variables[f.role as keyof typeof variables];
      env[name] = file;
      env[name + "_SHA256"] = f.sha256;
    } else if (Object.hasOwn(FULL_SOURCE_DEFINITIONS, f.role))
      full.push({
        role: f.role as FullSourceRole,
        file,
        sha256: f.sha256,
        sourceSchemaSha256: f.sourceSchemaSha256!,
        sourceRecordCount: f.sourceRecordCount!,
        sourceValidationSha256: f.sourceValidationSha256!,
        sourceValidatedOffline: f.sourceValidatedOffline!,
      });
    else throw new Error("Unrecognized private emulation role");
  }
  env.PRISM_PRIVATE_FULL_SOURCES = JSON.stringify(parseFullSourceConfigs(full));
  return env;
}
