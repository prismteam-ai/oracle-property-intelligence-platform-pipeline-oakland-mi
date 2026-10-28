import { useEffect, useState } from "react";
import type { SourceContext } from "../../../packages/hosted-runtime/src/source-context.ts";
import { get } from "./model.ts";
export function MunicipalSource({
  sourceId,
  recordId,
}: {
  sourceId: string;
  recordId: string;
}) {
  const [source, setSource] = useState<SourceContext | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    setSource(null);
    setFailed(false);
    const abort = new AbortController(),
      page = recordId.match(/:page:(\d+)/)?.[1];
    let active = true;
    void get<{ source: SourceContext }>(
      `source-context?sourceId=${encodeURIComponent(sourceId)}${page ? `&page=${page}` : ""}`,
      abort.signal,
    )
      .then((v) => {
        if (active) setSource(v.source);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [sourceId, recordId]);
  if (!source)
    return (
      <p className="muted">
        {failed
          ? "Report context unavailable. No additional source facts inferred."
          : "Loading report context…"}
      </p>
    );
  return (
    <div className="source-context">
      <p>
        <a
          href={source.pageUrl ?? source.officialReportUrl}
          target="_blank"
          rel="noreferrer"
        >
          {source.visibleTitle}
          {source.page ? ` · page ${source.page}` : ""}
        </a>{" "}
        ·{" "}
        <a
          href={source.officialLandingPageUrl}
          target="_blank"
          rel="noreferrer"
        >
          Official report page
        </a>
      </p>
      <p>
        Retrieved {source.sourceObservedAt}. Declared report period: not stated
        in reviewed headers.
      </p>
      <p>
        Observed sale dates: {source.observedSaleDateRange.from}–
        {source.observedSaleDateRange.to}. This range is not the declared report
        period.
      </p>
      <p>{source.exactPinMatchMethod}.</p>
      <p>
        Low-confidence building year proxy. Roof replacement and condition are
        unverified. Reported sales are partial history and do not establish
        ten-year ownership.
      </p>
    </div>
  );
}
