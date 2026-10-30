export const oaklandParcelProfile = Object.freeze({
  id: "oakland-tax-parcel-plus-v1",
  county: "oakland",
  state: "MI",
  source: "Oakland County Enterprise GIS",
  layer: 1,
  sourceId: "oakland-official-parcel",
  nativeIdField: "KEYPIN",
  status: "supported_partial",
  fields: [
    "KEYPIN",
    "PIN",
    "REVISIONDATE",
    "CVTTAXCODE",
    "CVTTAXDESCRIPTION",
    "CLASSCODE",
    "SITEADDRESS",
    "SITECITY",
    "SITESTATE",
    "SITEZIP5",
    "ASSESSEDVALUE",
    "TAXABLEVALUE",
    "NUM_BEDS",
    "NUM_BATHS",
    "STRUCTURE_DESC",
    "LIVING_AREA_SQFT",
    "NAME1",
    "NAME2",
    "POSTALADDRESS",
    "Shape",
  ],
  notInSource: ["PHONE", "EMAIL"],
  fieldAuthority:
    "Use a timestamped source-specific field classification and terms digest; metadata presence alone does not establish populated values.",
  limitations: [
    "GIS features are not the certified assessed-property population",
    "Source-specific terms govern use; irreversible publication requires exact Human approval",
    "Parcel metadata does not establish roof age, ownership transfer or permit history",
  ],
} as const);
export type AccessDecision = {
  state: "ok" | "cooldown" | "blocked" | "retryable";
  retryAfterSeconds: number | null;
};
export function classifySourceResponse(
  status: number,
  body: string,
  retryAfter?: string,
  now = Date.now(),
): AccessDecision {
  if (
    [401, 403].includes(status) ||
    /captcha|cf-chl-|login required|access denied/i.test(body)
  )
    return { state: "blocked", retryAfterSeconds: null };
  if (status === 429) {
    let seconds = 60;
    if (retryAfter) {
      if (/^\d+$/.test(retryAfter)) seconds = Number(retryAfter);
      else {
        const at = Date.parse(retryAfter);
        if (Number.isFinite(at))
          seconds = Math.max(0, Math.ceil((at - now) / 1000));
      }
    }
    return { state: "cooldown", retryAfterSeconds: seconds };
  }

  return {
    state:
      status >= 500
        ? "retryable"
        : status >= 200 && status < 300
          ? "ok"
          : "blocked",
    retryAfterSeconds: null,
  };
}

export class SourceAccessGuard {
  constructor(private clock: () => number = () => Date.now()) {}
  private stopped = false;
  private consecutive429 = 0;
  private retries = 0;
  observe(status: number, body: string, retryAfter?: string): AccessDecision {
    if (this.stopped) return { state: "blocked", retryAfterSeconds: null };
    const decision = classifySourceResponse(
      status,
      body,
      retryAfter,
      this.clock(),
    );
    this.consecutive429 = status === 429 ? this.consecutive429 + 1 : 0;
    if (decision.state === "blocked" || this.consecutive429 >= 2) {
      this.stopped = true;
      return { state: "blocked", retryAfterSeconds: null };
    }
    if (decision.state === "cooldown" || decision.state === "retryable") {
      this.retries++;
      if (this.retries > 2) {
        this.stopped = true;
        return { state: "blocked", retryAfterSeconds: null };
      }
    }
    return decision;
  }
}
