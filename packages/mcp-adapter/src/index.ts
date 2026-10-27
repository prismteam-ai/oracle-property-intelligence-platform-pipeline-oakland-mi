import { DomainError } from "../../contracts/src/index.ts";
import { SnapshotReader } from "../../query/src/index.ts";
import { z } from "zod";
const Call = z
  .object({
    tool: z.enum([
      "listDatasets",
      "searchProperties",
      "getProperty",
      "getSchema",
    ]),
    args: z.unknown(),
  })
  .strict();
export function callTool(reader: SnapshotReader, input: unknown): unknown {
  const parsed = Call.safeParse(input);
  if (!parsed.success)
    throw new DomainError(
      "UNSUPPORTED_TOOL",
      "Only bounded evidence tools are available; SQL, HTTP, filesystem and outreach are not tools",
    );
  const { tool, args } = parsed.data;
  if (tool === "listDatasets")
    return {
      snapshotId: reader.snapshotId,
      count: reader.properties.length,
      scope: { state: "MI", county: "oakland" },
      upstreamMcp: false,
    };
  if (tool === "getSchema")
    return {
      contractVersion: "0.1.0",
      tools: ["searchProperties", "getProperty"],
      readOnly: true,
      sql: false,
    };
  if (tool === "searchProperties") return reader.search(args);
  const q = z
    .object({ id: z.string(), snapshotId: z.string() })
    .strict()
    .parse(args);
  return reader.detail(q.id, q.snapshotId);
}
