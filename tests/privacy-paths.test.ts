import { test, expect } from "vitest";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertPrivateDestination } from "../packages/receipts/src/private-paths.ts";
import { RunLedger } from "../packages/run-ledger/src/index.ts";
test("real output guard rejects equal, descendants and symlink/dangling destinations into repositories or return", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-path-"));
  try {
    const repos = path.join(root, "repos"),
      returned = path.join(root, "return"),
      privateDir = path.join(root, "private");
    await mkdir(repos);
    await mkdir(returned);
    await mkdir(privateDir);
    const protectedRoots = [repos, returned];
    await expect(
      assertPrivateDestination(repos, protectedRoots),
    ).rejects.toThrow("outside");
    await expect(
      assertPrivateDestination(path.join(returned, "new"), protectedRoots),
    ).rejects.toThrow("outside");
    await symlink(repos, path.join(privateDir, "repo-link"));
    await expect(
      assertPrivateDestination(
        path.join(privateDir, "repo-link/new/output"),
        protectedRoots,
      ),
    ).rejects.toThrow("outside");
    await symlink(
      path.join(returned, "not-created.json"),
      path.join(privateDir, "canonical.json"),
    );
    await expect(
      assertPrivateDestination(
        path.join(privateDir, "canonical.json"),
        protectedRoots,
      ),
    ).rejects.toThrow("outside");
    const anotherRepo = path.join(root, "another-repo");
    await mkdir(anotherRepo);
    await mkdir(path.join(anotherRepo, ".git"));
    await expect(
      assertPrivateDestination(
        path.join(anotherRepo, "data/new"),
        protectedRoots,
      ),
    ).rejects.toThrow("Git repository");
    expect(
      await assertPrivateDestination(
        path.join(privateDir, "safe/new"),
        protectedRoots,
      ),
    ).toBe(path.join(privateDir, "safe/new"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("source-native prototype-looking keys survive write, reload, delta and tombstone without inherited objects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-key-"));
  try {
    const ids = ["__proto__", "constructor", "toString"];
    const input = ids.map((nativeId, i) => ({
      nativeId,
      content: { value: i },
    }));
    const a = new RunLedger(root);
    await a.run("benign-initial", [
      { nativeId: "benign", content: { value: 0 } },
    ]);
    const run = await a.run("prototype-keys", input);
    expect(run.added).toBe(3);
    const b = new RunLedger(root);
    expect(
      Object.values((await b.inspect()).records)
        .map((r) => r.nativeId)
        .sort(),
    ).toEqual([...ids, "benign"].sort());
    expect(await b.readyRecords()).toHaveLength(4);
    const next = await b.run("prototype-delta", [
      { nativeId: "__proto__", content: { value: 99 } },
      { nativeId: "constructor", content: {}, tombstone: true },
      { nativeId: "toString", content: { value: 2 } },
    ]);
    expect(next).toMatchObject({
      added: 0,
      changed: 1,
      deleted: 1,
      unchanged: 1,
    });
    expect(
      Object.values((await b.inspect()).records).map((r) => r.nativeId),
    ).not.toContain("constructor");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same native ID in independent sources has independent state and tombstones", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-source-scope-"));
  try {
    const l = new RunLedger(root);
    await l.run("source-a", [{ nativeId: "001", content: { value: "A" } }], {
      source: "official-a",
    });
    await l.run("source-b", [{ nativeId: "001", content: { value: "B" } }], {
      source: "official-b",
    });
    expect(await l.readyRecords()).toHaveLength(2);
    await l.run(
      "source-a-delete",
      [{ nativeId: "001", content: {}, tombstone: true }],
      { source: "official-a" },
    );
    expect(await l.readyRecords()).toEqual([{ value: "B" }]);
    await expect(
      l.run("source-b", [{ nativeId: "001", content: { value: "B" } }], {
        source: "official-a",
      }),
    ).rejects.toThrow("source");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
