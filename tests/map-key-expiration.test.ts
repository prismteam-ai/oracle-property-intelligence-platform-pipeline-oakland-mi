import { expect, it } from "vitest";
import {
  MAP_KEY_MAX_LIFETIME_MS,
  validMapKeyExpiration,
} from "../infra/cdk/map-key-expiration.ts";

const now = Date.parse("2026-10-29T04:17:25Z");
const at = (offset: number) => new Date(now + offset).toISOString();

it("permits a fourteen-day review tail after up to four hours of verification", () => {
  expect(validMapKeyExpiration(at(14 * 86400000), now)).toBe(true);
  expect(validMapKeyExpiration(at(MAP_KEY_MAX_LIFETIME_MS), now)).toBe(true);
});

it("rejects even one millisecond beyond the finite review and verification bound", () => {
  expect(validMapKeyExpiration(at(MAP_KEY_MAX_LIFETIME_MS + 1), now)).toBe(
    false,
  );
});

it("rejects expired, current and malformed expiration times", () => {
  for (const value of [at(-1), at(0), "", "invalid", "Infinity"])
    expect(validMapKeyExpiration(value, now)).toBe(false);
});

it("requires a finite trusted comparison clock", () => {
  expect(validMapKeyExpiration(at(1000), Number.NaN)).toBe(false);
  expect(validMapKeyExpiration(at(1000), Number.POSITIVE_INFINITY)).toBe(false);
});
