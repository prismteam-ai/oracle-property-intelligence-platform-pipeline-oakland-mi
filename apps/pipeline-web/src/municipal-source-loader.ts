import {
  sourceContext,
  type SourceContext,
} from "../../../packages/hosted-runtime/src/source-context.ts";
import { get } from "./model.ts";

/** Only retained, registered PDF reports have this optional context endpoint. */
export async function loadMunicipalReportContext(
  sourceId: string,
  recordId: string,
  signal: AbortSignal,
  transport = get<{ source: SourceContext }>,
): Promise<SourceContext | null> {
  const matchedPage = recordId.match(/:page:(\d+)/)?.[1];
  const page = matchedPage === undefined ? undefined : Number(matchedPage);
  if (!sourceContext(sourceId, page)) return null;
  const result = await transport(
    `source-context?sourceId=${encodeURIComponent(sourceId)}${page === undefined ? "" : `&page=${page}`}`,
    signal,
  );
  return result.source;
}
