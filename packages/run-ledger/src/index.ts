import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { digest, safeArtifactKey } from "../../identity/src/index.ts";
export interface SourceItem {
  nativeId: string;
  content: Record<string, unknown>;
  tombstone?: boolean;
}
export interface RunRecord {
  id: string;
  at: string;
  source: string;
  sourceCount: number;
  processed: number;
  added: number;
  changed: number;
  deleted: number;
  unchanged: number;
  state: "running" | "complete";
  inputDigest: string;
  transformVersion: string;
  limitations: string[];
}
interface StoredRecord {
  sourceId: string;
  nativeId: string;
  hash: string;
  transformVersion: string;
  content: Record<string, unknown>;
}
interface State {
  version: 2;
  runs: RunRecord[];
  records: Record<string, StoredRecord>;
}
const recordKey = (sourceId: string, nativeId: string) =>
  digest([sourceId, nativeId]);
const markerName = (sourceId: string, nativeId: string) =>
  `${safeArtifactKey(JSON.stringify([sourceId, nativeId]))}.ready.json`;
export class RunLedger {
  constructor(
    private root: string,
    private clock: () => string = () => new Date().toISOString(),
  ) {}
  private async load(): Promise<State> {
    try {
      const parsed = JSON.parse(
        await readFile(path.join(this.root, "ledger.json"), "utf8"),
      ) as State;
      if (
        parsed.version !== 2 ||
        !Array.isArray(parsed.runs) ||
        !parsed.records ||
        typeof parsed.records !== "object" ||
        Array.isArray(parsed.records)
      )
        throw new Error(
          "Journal schema mismatch; archive the previous local journal and start a fresh v2 replay",
        );
      parsed.records = Object.assign(
        Object.create(null) as State["records"],
        parsed.records,
      );
      return parsed;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return {
          version: 2,
          runs: [],
          records: Object.create(null) as State["records"],
        };
      throw error;
    }
  }
  private async save(state: State): Promise<void> {
    const dest = path.join(this.root, "ledger.json");
    await writeFile(`${dest}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${dest}.tmp`, dest);
  }
  async inspect(): Promise<State> {
    return this.load();
  }
  async readyRecords(): Promise<Record<string, unknown>[]> {
    const state = await this.load();
    const ready: Record<string, unknown>[] = [];
    for (const [key, record] of Object.entries(state.records)) {
      const marker = JSON.parse(
        await readFile(
          path.join(this.root, markerName(record.sourceId, record.nativeId)),
          "utf8",
        ),
      ) as {
        sourceId: string;
        nativeId: string;
        contentHash: string;
        transformVersion: string;
      };
      if (
        key !== recordKey(record.sourceId, record.nativeId) ||
        marker.sourceId !== record.sourceId ||
        marker.nativeId !== record.nativeId ||
        marker.transformVersion !== record.transformVersion ||
        marker.contentHash !== record.hash ||
        digest([record.content, record.transformVersion]) !== record.hash
      )
        throw new Error(
          "Ready marker does not match current validated content",
        );
      ready.push(record.content);
    }
    return ready;
  }
  async run(
    id: string,
    items: SourceItem[],
    options: {
      transformVersion?: string;
      crashAfter?: number;
      source?: string;
    } = {},
  ): Promise<RunRecord> {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid run ID");
    if (new Set(items.map((i) => i.nativeId)).size !== items.length)
      throw new Error("Duplicate native keys in input partition");
    const source = options.source ?? "synthetic-fixture";
    if (!source) throw new Error("Source identity required");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const mutex = new DatabaseSync(path.join(this.root, "writer.lock.db"));
    try {
      mutex.exec("PRAGMA busy_timeout=2000");
      mutex.exec("BEGIN IMMEDIATE");
    } catch (error) {
      mutex.close();
      throw new Error("Could not acquire local writer mutex", { cause: error });
    }
    try {
      const state = await this.load(),
        inputDigest = digest(items),
        version = options.transformVersion ?? "v1";
      let run = state.runs.find((r) => r.id === id);
      if (
        run &&
        (run.source !== source ||
          run.inputDigest !== inputDigest ||
          run.transformVersion !== version)
      )
        throw new Error(
          "Run identity reused with changed manifest/source; create a new immutable run",
        );
      if (run?.state === "complete") return run;
      if (!run) {
        run = {
          id,
          at: this.clock(),
          source,
          sourceCount: items.length,
          processed: 0,
          added: 0,
          changed: 0,
          deleted: 0,
          unchanged: 0,
          state: "running",
          inputDigest,
          transformVersion: version,
          limitations: ["P1 sample/fixture only; not county completeness"],
        };
        state.runs.push(run);
        await this.save(state);
      }
      for (let index = run.processed; index < items.length; index++) {
        const item = items[index]!,
          key = recordKey(source, item.nativeId),
          old = state.records[key],
          hash = digest([item.content, version]),
          marker = path.join(this.root, markerName(source, item.nativeId));
        if (item.tombstone) {
          if (old) {
            delete state.records[key];
            run.deleted++;
          } else run.unchanged++;
          await unlink(marker).catch(() => undefined);
        } else if (old?.hash === hash) {
          if (digest([old.content, version]) !== hash)
            throw new Error("Stored content hash mismatch");
          let valid = false;
          try {
            const ready = JSON.parse(await readFile(marker, "utf8")) as {
              sourceId: string;
              nativeId: string;
              contentHash: string;
              transformVersion: string;
            };
            valid =
              ready.sourceId === source &&
              ready.nativeId === item.nativeId &&
              ready.contentHash === hash &&
              ready.transformVersion === version;
          } catch {
            valid = false;
          }
          if (!valid) {
            await unlink(marker).catch(() => undefined);
            await writeFile(
              marker,
              JSON.stringify({
                sourceId: source,
                nativeId: item.nativeId,
                contentHash: hash,
                transformVersion: version,
              }),
              { mode: 0o600 },
            );
          }
          run.unchanged++;
        } else {
          await unlink(marker).catch(() => undefined);
          state.records[key] = {
            sourceId: source,
            nativeId: item.nativeId,
            hash,
            content: item.content,
            transformVersion: version,
          };
          if (old) run.changed++;
          else run.added++;
          await writeFile(
            marker,
            JSON.stringify({
              sourceId: source,
              nativeId: item.nativeId,
              contentHash: hash,
              transformVersion: version,
            }),
            { mode: 0o600 },
          );
        }
        run.processed = index + 1;
        await this.save(state);
        if (options.crashAfter === run.processed)
          throw new Error("Injected interruption after durable checkpoint");
      }
      run.state = "complete";
      await this.save(state);
      return run;
    } finally {
      mutex.exec("ROLLBACK");
      mutex.close();
    }
  }
}
