import { RunLedger } from "../packages/run-ledger/src/index.ts";
const root = process.argv[2]!;
const ledger = new RunLedger(root, () => "2026-10-26T00:00:00Z");
await ledger.run(
  "killed-process",
  Array.from({ length: 500 }, (_, i) => ({
    nativeId: `SYN-${i}`,
    content: { index: i },
  })),
);
