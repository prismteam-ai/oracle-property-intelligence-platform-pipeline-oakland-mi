import { afterEach, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createActiveSnapshot } from "../packages/query/src/active.ts";

afterEach(() => vi.unstubAllEnvs());

test("an official profile alone cannot enter a real snapshot without the operational authentication guard", async () => {
  vi.stubEnv("PRISM_DATA_MODE", "real");
  vi.stubEnv("PRISM_REQUIRE_AUTH", "");
  vi.stubEnv(
    "PRISM_OFFICIAL_PARCEL_PROFILE",
    "/synthetic/must-not-read-profile.json",
  );
  vi.stubEnv("PRISM_OFFICIAL_PARCEL_PROFILE_SHA256", "a".repeat(64));
  vi.stubEnv("PRISM_PRIVATE_FULL_SOURCES", "[]");
  for (const key of [
    "PRISM_OWNER_DERIVATIVES",
    "PRISM_PRIVATE_ENRICHMENT",
    "PRISM_PRIVATE_PERMITS",
    "PRISM_PRIVATE_SOURCE_INTAKE",
    "PRISM_PRIVATE_PROVIDER_OBSERVATIONS",
    "PRISM_PRIVATE_TRANSFER_OBSERVATIONS",
    "PRISM_PRIVATE_SOURCE_RUNS",
  ])
    vi.stubEnv(key, "");
  await expect(createActiveSnapshot()).rejects.toThrow(
    "explicit authenticated runtime mode",
  );
});

test("canonical CI and synthetic browser server clear both official-profile environment selectors", async () => {
  const ci = await readFile(
    new URL("../scripts/ci-verify.ts", import.meta.url),
    "utf8",
  );
  const expression = ci.match(/(\/\^PRISM_\(\?:[^\n]+\/).test/);
  expect(expression).not.toBeNull();
  const scrub = new RegExp(expression![1]!.slice(1, -1));
  for (const key of [
    "PRISM_OFFICIAL_PARCEL_PROFILE",
    "PRISM_OFFICIAL_PARCEL_PROFILE_SHA256",
  ])
    expect(scrub.test(key)).toBe(true);
  expect(scrub.test("PRISM_DATA_MODE")).toBe(false);
  const config = (await import("../playwright.config.ts")).default;
  const servers = Array.isArray(config.webServer)
    ? config.webServer
    : [config.webServer];
  const api = servers.find(
    (server) => server?.env && "PRISM_PRIVATE_FULL_SOURCES" in server.env,
  );
  expect(api?.env?.PRISM_OFFICIAL_PARCEL_PROFILE).toBe("");
  expect(api?.env?.PRISM_OFFICIAL_PARCEL_PROFILE_SHA256).toBe("");
});
