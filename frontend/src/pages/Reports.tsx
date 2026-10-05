import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { formatDay } from "../lib/format";
import { useAiStatus, useReports } from "../lib/queries";

/** More → Reports: one written report per check-in week. */
export function Reports() {
  const ai = useAiStatus();
  const reports = useReports();

  if (reports.isPending) return <Spinner />;
  if (reports.isError) {
    return <ErrorState message={reports.error.message} onRetry={() => void reports.refetch()} />;
  }
  const { current_week_start: current, reports: list } = reports.data;
  const hasCurrent = list.some((r) => r.week_start === current);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Weekly reports</h1>
      {!hasCurrent && ai.data?.enabled && (
        <Link
          to={`/reports/${current}`}
          className="flex items-center justify-between rounded-2xl border border-accent/40 bg-surface p-4"
        >
          <span>
            <span className="block font-medium">Week to {formatDay(current)}</span>
            <span className="block text-sm text-muted">Write this week's report</span>
          </span>
          <ChevronRight size={18} className="text-muted" />
        </Link>
      )}
      {list.length === 0 && !ai.data?.enabled && (
        <EmptyState
          title="No reports yet"
          body="Weekly reports need AI features, which you can switch on in Settings."
        />
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
          {list.map((r) => (
            <li key={r.week_start}>
              <Link
                to={`/reports/${r.week_start}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block font-medium">Week to {formatDay(r.week_start)}</span>
                  <span className="line-clamp-2 block text-sm text-muted">{r.summary}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
