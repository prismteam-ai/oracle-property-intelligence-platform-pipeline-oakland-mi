import { expect, test } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  CountyAcquisitionClient,
  acquireFrozenLayer,
  type HttpReply,
} from "../packages/county/src/acquire.ts";
import { sha256 } from "../packages/county/src/model.ts";
import {
  sourceFieldProfileDigest,
  type SourceFieldProfile,
} from "../packages/source-profiles/src/field-authority.ts";
function fieldProfile(
  sourceUrl: string,
  fields: string[],
  terms: string,
): SourceFieldProfile {
  return {
    version: "source-field-authority-v1",
    sourceId: "synthetic-official-source",
    sourceUrl,
    sourceMetadataSha256: sha256("synthetic metadata"),
    termsUrl: "https://official.invalid/terms",
    termsSha256: sha256(terms),
    reviewedAt: "2026-10-30T05:00:00.000Z",
    fields: Object.fromEntries(
      fields.map((field) => [
        field,
        {
          classification: "official_public",
          exposed: true,
          acquisitionAllowed: true,
          runtimeAllowed: true,
          publication: "eligible_pending_human",
        } as const,
      ]),
    ),
  };
}
const reply = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpReply => ({
  status,
  headers,
  body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
});
test("explicit redirect hops, source cadence, HTTP-date retry and access stops are audited", async () => {
  let now = Date.parse("2026-10-27T08:00:00Z"),
    calls = 0;
  const waits: number[] = [];
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-acquisition-"));
  const client = await CountyAcquisitionClient.open({
    privateRoot: root,
    protectedRoots: [],
    allowedHosts: ["official.invalid"],
    permittedPath: (u) => u.pathname.startsWith("/open/"),
    dependencies: {
      now: () => now,
      jitter: () => 0,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      request: async () => {
        calls++;
        return calls === 1
          ? reply(302, "", { location: "/open/layer" })
          : calls === 2
            ? reply(429, "", {
                "retry-after": new Date(now + 5000).toUTCString(),
              })
            : calls === 3
              ? reply(200, { allowed: true })
              : reply(403, "Forbidden");
      },
    },
  });
  const result = await client.get(
    "https://official.invalid/open/start",
    "test",
  );
  expect(JSON.parse(Buffer.from(result.body).toString())).toEqual({
    allowed: true,
  });
  expect(client.summary().events).toHaveLength(3);
  expect(client.summary().events[0]?.redirectTo).toBe(
    "https://official.invalid/open/layer",
  );
  expect(waits.some((ms) => ms >= 5000)).toBe(true);
  expect(client.summary().dataRequests).toBe(3);
  await expect(
    client.get("https://official.invalid/open/forbidden", "test"),
  ).rejects.toThrow("stop");
  await expect(
    client.get("https://official.invalid/open/again", "test"),
  ).rejects.toThrow("stopped");
  expect(calls).toBe(4);
  await expect(
    client.get("https://foreign.invalid/open/else", "test"),
  ).rejects.toThrow("Unapproved");
});
test("actual interrupted acquisition resumes immutable ready pages without duplicate reads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-resume-"));
  let calls = 0,
    now = 0;
  const client = await CountyAcquisitionClient.open({
    privateRoot: path.join(root, "raw"),
    protectedRoots: [],
    allowedHosts: ["official.invalid"],
    permittedPath: () => true,
    dependencies: {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      jitter: () => 0,
      request: async (url) => {
        calls++;
        const where = new URL(url).searchParams.get("where")!;
        const first = where.includes(">= 1 ") ? 1 : 3;
        return reply(200, {
          features: [first, first + 1].map((id) => ({
            attributes: { OBJECTID: id, PIN: "synthetic-" + id },
          })),
        });
      },
    },
  });
  const profile = fieldProfile(
    "https://official.invalid/open",
    ["OBJECTID", "PIN"],
    "test terms",
  );
  const options = {
    client,
    source: "https://official.invalid/open",
    oidField: "OBJECTID",
    fields: ["OBJECTID", "PIN"],
    ids: [1, 2, 3, 4],
    privateDirectory: path.join(root, "pages"),
    termsDigest: sha256("test terms"),
    sourceProfile: profile,
    fieldClassificationDigest: sourceFieldProfileDigest(profile),
    returnGeometry: false,
    batchSize: 2,
  };
  await expect(
    acquireFrozenLayer({
      ...options,
      afterPage: async () => {
        throw new Error(
          "Synthetic process interruption after durable ready checkpoint",
        );
      },
    }),
  ).rejects.toThrow("interruption");
  expect(calls).toBe(1);
  const pages = await acquireFrozenLayer(options);
  expect(pages).toHaveLength(2);
  expect(calls).toBe(2);
  await expect(
    acquireFrozenLayer({ ...options, termsDigest: sha256("changed terms") }),
  ).rejects.toThrow("terms");
  const differentProfile = {
    ...profile,
    sourceUrl: "https://official.invalid/different",
  };
  await expect(
    acquireFrozenLayer({
      ...options,
      source: "https://official.invalid/different",
      sourceProfile: differentProfile,
      fieldClassificationDigest: sourceFieldProfileDigest(differentProfile),
    }),
  ).rejects.toThrow("contract mismatch");
  expect(calls).toBe(2);
  expect(
    JSON.parse(await readFile(pages[0]!.path, "utf8")).features,
  ).toHaveLength(2);
});
test("frozen census rejects source drift and fields not approved by the source profile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-drift-"));
  const client = await CountyAcquisitionClient.open({
    privateRoot: path.join(root, "raw"),
    protectedRoots: [],
    allowedHosts: ["official.invalid"],
    permittedPath: () => true,
    dependencies: {
      request: async () =>
        reply(200, {
          features: [
            { attributes: { OBJECTID: 1, PIN: "test" } },
            { attributes: { OBJECTID: 1, PIN: "test" } },
          ],
        }),
    },
  });
  const profile = fieldProfile(
    "https://official.invalid/open",
    ["OBJECTID", "PIN"],
    "terms",
  );
  const options = {
    client,
    source: "https://official.invalid/open",
    oidField: "OBJECTID",
    fields: ["OBJECTID", "PIN"],
    ids: [1, 2],
    privateDirectory: path.join(root, "pages"),
    termsDigest: sha256("terms"),
    sourceProfile: profile,
    fieldClassificationDigest: sourceFieldProfileDigest(profile),
    returnGeometry: false,
  };
  await expect(acquireFrozenLayer(options)).rejects.toThrow("drift");
  await expect(
    acquireFrozenLayer({ ...options, fields: ["OBJECTID", "NAME1"] }),
  ).rejects.toThrow("excluded");
});

test("official classified owner fields are acquired verbatim including null names", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-official-owners-"));
  const fields = ["OBJECTID", "NAME1", "NAME2", "POSTALADDRESS"];
  const profile = fieldProfile(
    "https://official.invalid/open",
    fields,
    "terms",
  );
  const attributes = {
    OBJECTID: 1,
    NAME1: null,
    NAME2: null,
    POSTALADDRESS: "  SYNTHETIC OBSERVED POSTAL MI 00000  ",
  };
  const client = await CountyAcquisitionClient.open({
    privateRoot: path.join(root, "raw"),
    protectedRoots: [],
    allowedHosts: ["official.invalid"],
    permittedPath: () => true,
    dependencies: {
      request: async () => reply(200, { features: [{ attributes }] }),
    },
  });
  const pages = await acquireFrozenLayer({
    client,
    source: profile.sourceUrl,
    oidField: "OBJECTID",
    fields,
    ids: [1],
    privateDirectory: path.join(root, "pages"),
    termsDigest: profile.termsSha256,
    fieldClassificationDigest: sourceFieldProfileDigest(profile),
    sourceProfile: profile,
    returnGeometry: false,
  });
  expect(
    JSON.parse(await readFile(pages[0]!.path, "utf8")).features[0].attributes,
  ).toEqual(attributes);
});

test("persisted Retry-After cooldown survives an interrupted client and a reopened process view", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-cooldown-"));
  let now = Date.parse("2026-10-27T08:00:00Z");
  const options = {
    privateRoot: root,
    protectedRoots: [],
    allowedHosts: ["official.invalid"],
    permittedPath: () => true,
  };
  const first = await CountyAcquisitionClient.open({
    ...options,
    dependencies: {
      now: () => now,
      jitter: () => 0,
      request: async () => reply(429, "", { "retry-after": "10" }),
      sleep: async () => {
        throw new Error("Synthetic process interruption during cooldown");
      },
    },
  });
  await expect(
    first.get("https://official.invalid/open", "test"),
  ).rejects.toThrow("interruption");
  const waits: number[] = [];
  const restarted = await CountyAcquisitionClient.open({
    ...options,
    dependencies: {
      now: () => now,
      jitter: () => 0,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      request: async () => reply(200, { complete: true }),
    },
  });
  await restarted.get("https://official.invalid/open", "test");
  expect(waits[0]).toBeGreaterThanOrEqual(10000);
  expect(restarted.summary().dataRequests).toBe(2);
});
