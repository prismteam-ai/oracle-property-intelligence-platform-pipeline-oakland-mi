import { createHash } from "node:crypto";
export function digest(value: unknown): string {
  return createHash("sha256")
    .update(
      value instanceof Uint8Array
        ? value
        : typeof value === "string"
          ? value
          : JSON.stringify(value),
    )
    .digest("hex");
}
export function nativeIdentity(authority: string, nativeId: string): string {
  if (!authority || !nativeId)
    throw new Error("Authority and exact native identifier required");
  return `entity-${digest([authority, nativeId]).slice(0, 32)}`;
}
export function safeArtifactKey(nativeId: string): string {
  return `${nativeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100)}-${digest(nativeId).slice(0, 12)}`;
}
export interface IdentityClaim {
  companyId: string;
  licenseId: string;
  official: boolean;
  validFrom: string;
  validTo: string | null;
}
export function resolveCompany(
  claims: IdentityClaim[],
  asOf: string,
): {
  state: "resolved" | "unresolved" | "ambiguous";
  companyId: string | null;
} {
  const candidates = new Set(
    claims
      .filter(
        (c) =>
          c.official &&
          c.validFrom <= asOf &&
          (!c.validTo || c.validTo >= asOf),
      )
      .map((c) => c.companyId),
  );
  return {
    state:
      candidates.size === 1
        ? "resolved"
        : candidates.size
          ? "ambiguous"
          : "unresolved",
    companyId: candidates.size === 1 ? [...candidates][0]! : null,
  };
}
