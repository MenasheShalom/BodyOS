import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { aiErrorMessage } from "../components/ai/aiErrors";
import { PrivacyNotice } from "../components/ai/PrivacyNotice";
import { usePrivacyGate } from "../components/ai/privacy";
import { ErrorState, Spinner } from "../components/EmptyState";
import { formatDay } from "../lib/format";
import { useAiStatus, useReport, useWriteReport } from "../lib/queries";
import type { ReportTone, WeeklyReport } from "../lib/types";

const TONE_STYLE: Record<ReportTone, string> = {
  good: "border-good/50",
  watch: "border-bad/50",
  neutral: "border-border",
};
const TONE_LABEL: Record<ReportTone, string> = {
  good: "Going well",
  watch: "Needs attention",
  neutral: "",
};

function ReportBody({ report }: { report: WeeklyReport }) {
  return (
    <>
      <p className="text-lg leading-snug">{report.summary}</p>
      {report.sections.map((s) => (
        <section
          key={s.title}
          aria-label={s.title}
          className={`space-y-1 rounded-2xl border-l-4 bg-surface p-4 ${TONE_STYLE[s.tone]}`}
        >
          <h2 className="flex items-baseline justify-between gap-2 font-medium">
            {s.title}
            {TONE_LABEL[s.tone] && (
              <span className="text-xs font-normal text-muted">{TONE_LABEL[s.tone]}</span>
            )}
          </h2>
          <p className="text-sm">{s.body}</p>
        </section>
      ))}
      <section aria-label="Focus for next week" className="rounded-2xl bg-surface p-4">
        <h2 className="mb-2 font-medium">Next week</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {report.focus.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>
      {report.fallback && (
        <p role="note" className="text-xs text-muted">
          The AI's text didn't match your numbers, so this is a plain summary of them instead.
        </p>
      )}
    </>
  );
}

/** One week's report. Opening a week without one writes it (after the one-time notice). */
export function ReportDetail() {
  const { week = "" } = useParams();
  const ai = useAiStatus();
  const report = useReport(week);
  const write = useWriteReport();
  const gate = usePrivacyGate("weekly_report");
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);

  const canWrite = !!ai.data?.enabled && gate.ready && !gate.needed;
  const missing = report.data === null;

  const run = () => {
    setError(null);
    write.mutate(week, { onError: (e) => setError(aiErrorMessage(e)) });
  };

  useEffect(() => {
    if (missing && canWrite && !asked.current) {
      asked.current = true;
      run();
    }
    // `run` is recreated each render; the ref keeps this to one automatic request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, canWrite]);

  const back = (
    <Link to="/reports" className="flex items-center gap-1 text-sm text-muted">
      <ChevronLeft size={16} /> All reports
    </Link>
  );

  let body;
  if (report.isPending) body = <Spinner />;
  else if (report.isError) {
    body = <ErrorState message={report.error.message} onRetry={() => void report.refetch()} />;
  } else if (report.data) {
    body = (
      <>
        <ReportBody report={report.data} />
        {report.data.can_regenerate && ai.data?.enabled && (
          <button
            type="button"
            disabled={write.isPending}
            onClick={run}
            className="w-full rounded-xl bg-surface-2 py-2.5 text-sm disabled:opacity-60"
          >
            {write.isPending ? "Rewriting…" : "Rewrite this report"}
          </button>
        )}
      </>
    );
  } else if (!ai.data?.enabled) {
    body = (
      <p className="rounded-2xl bg-surface p-4 text-sm text-muted">
        Reports need AI features. You can switch them on in Settings.
      </p>
    );
  } else if (gate.needed) {
    body = (
      <PrivacyNotice
        what="this week's numbers (body trends, food totals, targets and goals)"
        onContinue={gate.accept}
        onCancel={() => window.history.back()}
      />
    );
  } else if (error) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
        <button type="button" onClick={run} className="rounded-xl bg-accent px-4 py-2 text-bg">
          Try again
        </button>
      </div>
    );
  } else {
    body = (
      <p role="status" className="py-10 text-center text-sm text-muted">
        Writing your report…
      </p>
    );
  }

  return (
    <section className="space-y-4">
      {back}
      <h1 className="text-2xl font-semibold">Week to {formatDay(week)}</h1>
      {error && report.data && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      {body}
    </section>
  );
}
