import { test, expect } from "vitest";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { RunLedger } from "../packages/run-ledger/src/index.ts";
test("actual SIGKILL releases OS mutex and resumes a persisted checkpoint", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-crash-"));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "tests/crash-worker.ts", root],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  let processed = 0;
  try {
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 10));
      try {
        const state = JSON.parse(
          await readFile(path.join(root, "ledger.json"), "utf8"),
        ) as { runs: { processed: number }[] };
        processed = state.runs[0]?.processed ?? 0;
        if (processed > 2) break;
      } catch {
        /* Worker has not checkpointed yet. */
      }
    }
    expect(processed).toBeGreaterThan(2);
    expect(processed).toBeLessThan(500);
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
    const ledger = new RunLedger(root);
    const result = await ledger.run(
      "killed-process",
      Array.from({ length: 500 }, (_, i) => ({
        nativeId: `SYN-${i}`,
        content: { index: i },
      })),
    );
    expect(result.processed).toBe(500);
    expect(result.added).toBe(500);
    expect(result.state).toBe("complete");
    expect(Object.keys((await ledger.inspect()).records)).toHaveLength(500);
  } finally {
    child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
