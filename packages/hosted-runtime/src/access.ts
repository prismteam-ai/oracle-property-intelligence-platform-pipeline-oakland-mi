import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
export class AccessError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface ReviewSession {
  id: string;
  workspaceId: string;
  expiresAt: number;
}
export interface AccessConfig {
  signingKey: string;
  reviewCodeDigest: string;
  keyVersion: string;
  sessionTtlSeconds?: number;
}
const digest = (s: string) => createHash("sha256").update(s).digest();
export const accessCodeDigest = (s: string) => digest(s).toString("hex");
export class AccessService {
  readonly ttl: number;
  constructor(
    private readonly config: AccessConfig,
    private readonly clock = Date.now,
  ) {
    if (
      Buffer.byteLength(config.signingKey) < 32 ||
      !/^[a-f0-9]{64}$/.test(config.reviewCodeDigest) ||
      !/^[a-zA-Z0-9_-]{1,32}$/.test(config.keyVersion)
    )
      throw new Error("Invalid review access configuration");
    this.ttl = config.sessionTtlSeconds ?? 3600;
    if (this.ttl < 60 || this.ttl > 86400)
      throw new Error("Session lifetime outside bounded range");
  }
  issue(accessCode: string): { session: ReviewSession; token: string } {
    if (
      typeof accessCode !== "string" ||
      accessCode.length > 256 ||
      !timingSafeEqual(
        digest(accessCode),
        Buffer.from(this.config.reviewCodeDigest, "hex"),
      )
    )
      throw new AccessError(401, "Access code rejected");
    const session = {
      id: randomUUID(),
      workspaceId: "review",
      expiresAt: Math.floor(this.clock() / 1000) + this.ttl,
    };
    const payload = Buffer.from(
      JSON.stringify({ ...session, v: this.config.keyVersion }),
    ).toString("base64url");
    return { session, token: `${payload}.${this.sign(payload)}` };
  }
  verify(token: string): ReviewSession {
    if (token.length > 2048) throw new AccessError(401, "Session rejected");
    const [payload, signature, ...extra] = token.split(".");
    const expected = this.sign(payload ?? "");
    if (
      !payload ||
      !signature ||
      extra.length ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new AccessError(401, "Session rejected");
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new AccessError(401, "Session rejected");
    }
    const s = value as ReviewSession & { v: string };
    const now = Math.floor(this.clock() / 1000);
    if (
      !s ||
      !/^[a-f0-9-]{36}$/.test(s.id) ||
      s.workspaceId !== "review" ||
      s.v !== this.config.keyVersion ||
      !Number.isInteger(s.expiresAt) ||
      s.expiresAt <= now ||
      s.expiresAt > now + this.ttl
    )
      throw new AccessError(401, "Session expired or rotated");
    return { id: s.id, workspaceId: s.workspaceId, expiresAt: s.expiresAt };
  }
  private sign(payload: string) {
    return createHmac("sha256", this.config.signingKey)
      .update(payload)
      .digest("base64url");
  }
}
export function readSessionCookie(
  headers: Record<string, string | undefined>,
): string {
  const raw = headers.cookie ?? headers.Cookie ?? "";
  const cookies = raw
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("prism_review="));
  if (cookies.length !== 1)
    throw new AccessError(401, "Review session required");
  return cookies[0]!.slice("prism_review=".length);
}
export function sessionCookie(
  token: string,
  ttl: number,
  secure = true,
): string {
  return `prism_review=${token}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Strict; Path=/api; Max-Age=${ttl}`;
}
export function clearSessionCookie(secure = true) {
  return sessionCookie("", 0, secure);
}
