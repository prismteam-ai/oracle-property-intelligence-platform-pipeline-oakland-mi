export interface Run {
  id: string;
  at: string;
  source: string;
  sourceCount: number | null;
  processed: number | null;
  added: number | null;
  changed: number | null;
  deleted: number | null;
  unchanged: number | null;
  state: string;
  limitations: string[];
  raw?: unknown;
}
export interface Coverage {
  source: string;
  scope: string;
  state: string;
  count: number | null;
  limitations: string[];
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const number = (v: unknown): number | null =>
  typeof v === "number" ? v : null;
export function normalizeRun(value: unknown): Run {
  const r = object(value);
  if ("at" in r) return value as Run;
  return {
    id: String(r.id ?? "Source run"),
    at: String(r.completedAt ?? r.startedAt ?? ""),
    source: String(r.kind ?? "official source"),
    sourceCount: number(r.sourceCount),
    processed: number(r.processed),
    added: number(r.added),
    changed: number(r.changed),
    deleted: number(r.deleted),
    unchanged: number(r.unchanged),
    state: r.complete ? "COMPLETE" : "INCOMPLETE",
    limitations: Array.isArray(r.limitations)
      ? r.limitations.map(String)
      : ["Source-layer counts differ from canonical property counts."],
    raw: value,
  };
}
export function normalizeCoverage(value: unknown): Coverage {
  const c = object(value);
  if ("source" in c) return value as Coverage;
  const counts = object(c.counts);
  return {
    source: "Official selected layers",
    scope: `${number(counts.parcels)?.toLocaleString() ?? "Unknown"} parcels · ${number(counts.addresses)?.toLocaleString() ?? "Unknown"} official site addresses`,
    state: c.completeSelectedLayers ? "complete_selected_layers" : "partial",
    count: number(counts.properties),
    limitations: Array.isArray(c.limitations)
      ? c.limitations.map(String)
      : ["Coverage unknown"],
  };
}
export interface Manifest {
  snapshotId: string;
  files?: { name: string; bytes: number; sha256: string }[];
  items?: { name: string; size: number; digest: string; cid: string | null }[];
  car?: { state: string; reason: string };
  limitations?: string[];
  [key: string]: unknown;
}
export interface Health {
  snapshotId: string;
  snapshotDigest: string;
  mode: "real" | "synthetic";
  count: number;
  addressCount?: number;
  buildId: string;
  accessMode: string;
  dataMode?: "synthetic" | "real-public" | "protected-real";
  head?: string;
  tree?: string;
  stage?: string;
  region?: string;
  contractVersion?: string;
  contractSha256?: string;
}
export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`/api/${path}`, { signal });
  if (r.status === 401) throw new Error("REVIEW_ACCESS_REQUIRED");
  if (!r.ok)
    throw new Error("The data service could not complete this request.");
  return r.json() as Promise<T>;
}

export const roofBasis = (basis: string) =>
  basis === "built_year" ? "building year proxy" : basis.replaceAll("_", " ");
