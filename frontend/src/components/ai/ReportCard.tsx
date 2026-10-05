import { ChevronRight, ScrollText } from "lucide-react";
import { Link } from "react-router";
import { formatDay } from "../../lib/format";
import { addDays, isoDay } from "../../lib/meals";
import { useAiStatus, useReports } from "../../lib/queries";

const SHOW_FOR_DAYS = 3; // the check-in day and the two after it

/** Home: "Your weekly report" around the check-in day, until this week's report exists. */
export function ReportCard() {
  const ai = useAiStatus();
  const reports = useReports(!!ai.data?.enabled);
  if (!ai.data?.enabled || !reports.data) return null;
  const week = reports.data.current_week_start;
  const today = isoDay(new Date());
  const recent = today >= week && today < addDays(week, SHOW_FOR_DAYS);
  if (!recent || reports.data.reports.some((r) => r.week_start === week)) return null;
  return (
    <Link
      to={`/reports/${week}`}
      className="flex items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-surface p-4"
    >
      <span className="flex items-center gap-3">
        <ScrollText size={20} className="text-accent" />
        <span>
          <span className="block font-medium">Your weekly report</span>
          <span className="block text-sm text-muted">Week to {formatDay(week)}</span>
        </span>
      </span>
      <ChevronRight size={18} className="text-muted" />
    </Link>
  );
}
