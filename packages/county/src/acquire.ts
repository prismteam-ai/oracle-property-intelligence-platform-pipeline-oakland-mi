import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { assertPrivateDestination } from "../../receipts/src/private-paths.ts";
import { sha256, stableJson, sourceOid, type SourcePage } from "./model.ts";
import {
  validateSourceFieldProfile,
  type SourceFieldProfile,
} from "../../source-profiles/src/field-authority.ts";
export interface HttpReply {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}
export interface AcquisitionEvent {
  sequence: number;
  at: string;
  method: "GET";
  url: string;
  host: string;
  purpose: string;
  classification: "control" | "data";
  status: number | null;
  bytes: number;
  latencyMs: number;
  redirectTo?: string;
  retryAfterMs?: number;
  retryNotBefore?: string;
  sha256?: string;
  state: "reserved" | "complete" | "transport_error";
}
interface ClientState {
  version: 1;
  requests: number;
  dataRequests: number;
  bytes: number;
  events: AcquisitionEvent[];
  stoppedHosts: string[];
}
export interface AcquisitionDependencies {
  request: (url: string) => Promise<HttpReply>;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  jitter: () => number;
}
const defaults: AcquisitionDependencies = {
  request: async (url) => {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
      headers: { "User-Agent": "Prism-P2-official-open-data/1.0" },
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: new Uint8Array(await response.arrayBuffer()),
    };
  },
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  jitter: () => Math.random() * 200,
};
export class CountyAcquisitionClient {
  private lastRequest = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    private root: string,
    private state: ClientState,
    private allowedHosts: readonly string[],
    private permittedPath: (url: URL) => boolean,
    private dependencies: AcquisitionDependencies,
    private protectedRoots: readonly string[],
  ) {}
  static async open(options: {
    privateRoot: string;
    protectedRoots: string[];
    allowedHosts: string[];
    permittedPath: (url: URL) => boolean;
    dependencies?: Partial<AcquisitionDependencies>;
  }): Promise<CountyAcquisitionClient> {
    const root = await assertPrivateDestination(
      options.privateRoot,
      options.protectedRoots,
    );
    await mkdir(root, { recursive: true, mode: 0o700 });
    let state: ClientState;
    try {
      state = JSON.parse(
        await readFile(path.join(root, "request-state.json"), "utf8"),
      ) as ClientState;
      if (state.version !== 1 || !Array.isArray(state.events))
        throw new Error("Invalid request ledger");
    } catch (e) {
      if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
      state = {
        version: 1,
        requests: 0,
        dataRequests: 0,
        bytes: 0,
        events: [],
        stoppedHosts: [],
      };
    }
    const d = { ...defaults, ...options.dependencies };
    return new CountyAcquisitionClient(
      root,
      state,
      options.allowedHosts,
      options.permittedPath,
      d,
      options.protectedRoots,
    );
  }
  private async persist() {
    const p = path.join(this.root, "request-state.json");
    await writeFile(p + ".tmp", JSON.stringify(this.state, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(p + ".tmp", p);
  }
  private safe(url: string): URL {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.hash ||
      !this.allowedHosts.includes(u.hostname) ||
      !this.permittedPath(u) ||
      [...u.searchParams.keys()].some((k) =>
        /token|key|auth|password|email/i.test(k),
      )
    )
      throw new Error("Unapproved authenticated/path/host source request");
    if (this.state.stoppedHosts.includes(u.hostname))
      throw new Error("Source host is stopped");
    return u;
  }
  async get(
    url: string,
    purpose: string,
    classification: "control" | "data" = "data",
  ): Promise<{ body: Uint8Array; page: SourcePage }> {
    const operation = this.queue.then(async () => {
      const mutex = new DatabaseSync(
        path.join(this.root, "request-mutex.sqlite"),
      );
      mutex.exec("PRAGMA busy_timeout=0");
      const deadline = Date.now() + 60000;
      let acquired = false;
      try {
        while (!acquired) {
          try {
            mutex.exec("BEGIN IMMEDIATE");
            acquired = true;
          } catch (e) {
            if (
              !(e instanceof Error && /busy|locked/i.test(e.message)) ||
              Date.now() > deadline
            )
              throw e;
            await this.dependencies.sleep(100);
          }
        }
        try {
          this.state = JSON.parse(
            await readFile(path.join(this.root, "request-state.json"), "utf8"),
          ) as ClientState;
        } catch (e) {
          if (!(e instanceof Error && "code" in e && e.code === "ENOENT"))
            throw e;
        }
        return await this.perform(url, purpose, classification);
      } finally {
        if (acquired) mutex.exec("ROLLBACK");
        mutex.close();
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async privateDestination(candidate: string): Promise<string> {
    return assertPrivateDestination(candidate, this.protectedRoots);
  }
  private async perform(
    input: string,
    purpose: string,
    classification: "control" | "data",
  ): Promise<{ body: Uint8Array; page: SourcePage }> {
    let url = input;
    let retries = 0,
      redirects = 0;
    for (;;) {
      const u = this.safe(url);
      if (
        this.state.dataRequests + (classification === "data" ? 1 : 0) > 1200 ||
        this.state.bytes >= 5 * 1024 ** 3
      )
        throw new Error("Source request/byte ceiling reached");
      const delay =
        1000 +
        Math.max(0, this.dependencies.jitter()) -
        (this.dependencies.now() -
          Math.max(
            this.lastRequest.get(u.hostname) ?? -Infinity,
            ...this.state.events
              .filter((e) => e.host === u.hostname)
              .slice(-1)
              .map((e) => Date.parse(e.at)),
          ));
      const cooldown = Math.max(
        0,
        ...this.state.events
          .filter((event) => event.host === u.hostname && event.retryNotBefore)
          .map(
            (event) =>
              Date.parse(event.retryNotBefore!) - this.dependencies.now(),
          ),
      );
      if (Math.max(delay, cooldown) > 0)
        await this.dependencies.sleep(Math.max(delay, cooldown));
      const started = this.dependencies.now();
      this.lastRequest.set(u.hostname, started);
      const event: AcquisitionEvent = {
        sequence: this.state.requests + 1,
        at: new Date(started).toISOString(),
        method: "GET",
        url: u.toString(),
        host: u.hostname,
        purpose,
        classification,
        status: null,
        bytes: 0,
        latencyMs: 0,
        state: "reserved",
      };
      this.state.requests++;
      if (classification === "data") this.state.dataRequests++;
      this.state.events.push(event);
      await this.persist();
      let response: HttpReply;
      try {
        response = await this.dependencies.request(u.toString());
      } catch {
        event.state = "transport_error";
        event.latencyMs = this.dependencies.now() - started;
        await this.persist();
        if (++retries > 4)
          throw new Error("Source transport retries exhausted");
        await this.dependencies.sleep(Math.min(60000, 1000 * 2 ** retries));
        continue;
      }
      event.status = response.status;
      event.bytes = response.body.byteLength;
      event.latencyMs = this.dependencies.now() - started;
      event.sha256 = sha256(response.body);
      event.state = "complete";
      this.state.bytes += response.body.byteLength;
      await this.persist();
      if (this.state.bytes > 5 * 1024 ** 3)
        throw new Error(
          "Source response byte ceiling exceeded; acquisition stopped",
        );
      const type = response.headers["content-type"] ?? "";
      const suspicious =
        /text\/html/i.test(type) &&
        /captcha|access denied|verify you are human|challenge-platform/i.test(
          new TextDecoder().decode(response.body),
        );
      if (response.status === 401 || response.status === 403 || suspicious) {
        this.state.stoppedHosts.push(u.hostname);
        await this.persist();
        throw new Error("Access/challenge source stop; no bypass");
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (!location || ++redirects > 5)
          throw new Error("Invalid/repeated redirect");
        const next = new URL(location, u);
        event.redirectTo = next.toString();
        await this.persist();
        this.safe(next.toString());
        url = next.toString();
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        if (++retries > 4)
          throw new Error("Source rate/transient retries exhausted");
        const retry = response.headers["retry-after"];
        const seconds =
          retry && /^\d+(?:\.\d+)?$/.test(retry)
            ? Number(retry) * 1000
            : retry
              ? Date.parse(retry) - this.dependencies.now()
              : 0;
        const wait = Math.max(
          1000 * 2 ** retries,
          Number.isFinite(seconds) ? seconds : 0,
        );
        event.retryAfterMs = wait;
        event.retryNotBefore = new Date(
          this.dependencies.now() + wait,
        ).toISOString();
        await this.persist();
        await this.dependencies.sleep(wait);
        continue;
      }
      if (response.status !== 200)
        throw new Error("Source response rejected: " + response.status);
      const receipt = path.join(this.root, event.sha256 + ".body");
      await writeFile(receipt, response.body, { mode: 0o600 });
      return {
        body: response.body,
        page: { path: receipt, sha256: event.sha256!, observedAt: event.at },
      };
    }
  }
  summary(): Readonly<ClientState> {
    return structuredClone(this.state);
  }
}
/** Acquires exactly the frozen ID census; every page is checked before a ready checkpoint. */
export async function acquireFrozenLayer(options: {
  client: CountyAcquisitionClient;
  source: string;
  oidField: string;
  fields: readonly string[];
  ids: readonly number[];
  privateDirectory: string;
  termsDigest: string;
  fieldClassificationDigest: string;
  sourceProfile: SourceFieldProfile;
  returnGeometry: boolean;
  batchSize?: number;
  afterPage?: (page: SourcePage) => Promise<void>;
}): Promise<SourcePage[]> {
  if (
    !/^[a-f0-9]{64}$/.test(options.termsDigest) ||
    !/^[a-f0-9]{64}$/.test(options.fieldClassificationDigest)
  )
    throw new Error(
      "Current terms/service association and field freeze required",
    );
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.oidField))
    throw new Error("Invalid source OID column");
  validateSourceFieldProfile(options.sourceProfile, {
    sourceUrl: options.source,
    termsSha256: options.termsDigest,
    fieldClassificationDigest: options.fieldClassificationDigest,
    requestedFields: options.fields,
  });
  const ids = [...options.ids].sort((a, b) => a - b);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((x) => !Number.isSafeInteger(x) || x < 0)
  )
    throw new Error("Invalid/duplicate frozen ID census");
  const batchSize = options.batchSize ?? 2000;
  if (batchSize < 1 || batchSize > 2000) throw new Error("Unsafe batch size");
  await options.client.privateDestination(options.privateDirectory);
  await mkdir(options.privateDirectory, { recursive: true, mode: 0o700 });
  const acquisitionFingerprint = sha256(
    stableJson({
      source: options.source,
      oidField: options.oidField,
      fields: [...options.fields],
      idsDigest: sha256(JSON.stringify(ids)),
      termsDigest: options.termsDigest,
      fieldClassificationDigest: options.fieldClassificationDigest,
      returnGeometry: options.returnGeometry,
      batchSize,
    }),
  );
  const pages: SourcePage[] = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize),
      checkpoint = path.join(
        options.privateDirectory,
        String(index / batchSize) + ".json",
      );
    let receipt: (SourcePage & { acquisitionFingerprint: string }) | undefined;
    try {
      receipt = JSON.parse(await readFile(checkpoint, "utf8")) as SourcePage & {
        acquisitionFingerprint: string;
      };
      if (receipt.acquisitionFingerprint !== acquisitionFingerprint)
        throw new Error("Ready checkpoint acquisition contract mismatch");
      if (sha256(await readFile(receipt.path)) !== receipt.sha256)
        throw new Error("Invalid resumed raw receipt");
    } catch (e) {
      if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
    }
    let body: Uint8Array;
    if (receipt) body = await readFile(receipt.path);
    else {
      const u = new URL(options.source + "/query");
      u.search = new URLSearchParams({
        f: "json",
        where: `${options.oidField} >= ${batch[0]} AND ${options.oidField} <= ${batch.at(-1)}`,
        outFields: options.fields.join(","),
        orderByFields: options.oidField,
        resultRecordCount: String(batchSize),
        returnGeometry: String(options.returnGeometry),
        ...(options.returnGeometry ? { outSR: "4326" } : {}),
      }).toString();
      const response = await options.client.get(
        u.toString(),
        "Complete frozen county layer OID batch",
        "data",
      );
      body = response.body;
      receipt = {
        ...response.page,
        acquisitionFingerprint,
        index: index / batchSize,
        records: batch.length,
      };
    }
    const parsed = JSON.parse(new TextDecoder().decode(body)) as {
      features?: { attributes: Record<string, unknown> }[];
      error?: unknown;
      exceededTransferLimit?: boolean;
    };
    if (parsed.error || parsed.exceededTransferLimit || !parsed.features)
      throw new Error("Incomplete/error source batch");
    const received = parsed.features
      .map((f) => sourceOid(f.attributes[options.oidField]))
      .sort((a, b) => Number(a) - Number(b));
    if (
      received.length !== batch.length ||
      received.some((id, i) => id !== String(batch[i]))
    )
      throw new Error(
        "Source ID drift/duplicate/missing record; no incomplete promotion",
      );
    for (const feature of parsed.features)
      if (
        Object.keys(feature.attributes).some((k) => !options.fields.includes(k))
      )
        throw new Error(
          "Unexpected source field; private/public classification drift",
        );
    await writeFile(checkpoint + ".tmp", JSON.stringify(receipt) + "\n", {
      mode: 0o600,
    });
    await rename(checkpoint + ".tmp", checkpoint);
    pages.push(receipt);
    await options.afterPage?.(receipt);
  }
  return pages;
}
