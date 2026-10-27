import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { digest } from "../../identity/src/index.ts";
export interface Receipt {
  bodyDigest: string;
  sourceId: string;
  observedAt: string;
  rawRef: string;
  bytes: number;
}
export async function preserveReceipt(
  root: string,
  sourceId: string,
  body: string,
  observedAt: string,
): Promise<Receipt> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const hash = digest(body);
  const rawRef = path.join(root, `${hash}.raw`);
  try {
    await writeFile(rawRef, body, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
    if ((await readFile(rawRef, "utf8")) !== body)
      throw new Error("Immutable receipt collision", { cause: error });
  }
  return {
    bodyDigest: hash,
    sourceId,
    observedAt,
    rawRef,
    bytes: Buffer.byteLength(body),
  };
}
