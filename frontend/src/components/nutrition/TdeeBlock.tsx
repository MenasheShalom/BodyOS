import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ApiError } from "../../lib/api";
import { formatDay } from "../../lib/format";
import { WEEKDAYS } from "../../lib/nutritionSettings";
import { useTdee } from "../../lib/queries";
import type { Tdee } from "../../lib/types";
import { Spinner } from "../EmptyState";

const INTAKE = "var(--color-series-1)";
const BURN = "var(--color-series-2)";
const MIN_DAYS = 14;
const fmt = (n: number) => n.toLocaleString("en-GB");

function Key({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="16" height="10" aria-hidden="true">
        <line
          x1="0"
          y1="5"
          x2="16"
          y2="5"
          stroke={color}
          strokeWidth={2}
          strokeDasharray={dashed ? "4 3" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

/** Weekly average intake against the burn estimate: one measure (kcal), one axis. */
function IntakeVsBurn({ weeks }: { weeks: Tdee["weekly"] }) {
  const rows = weeks.map((w) => ({ day: w.day, intake: w.intake, burn: w.tdee }));
  const values = rows.flatMap((r) => [r.intake, r.burn]).filter((v): v is number => v != null);
  const lo = Math.floor((Math.min(...values) - 100) / 100) * 100;
  const hi = Math.ceil((Math.max(...values) + 100) / 100) * 100;
  return (
    <figure aria-label="Intake and burn by week">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <Key color={INTAKE} label="Average intake" />
        <Key color={BURN} label="Burn (estimate)" />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={formatDay}
              stroke="var(--color-muted)"
              fontSize={12}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={[lo, hi]}
              stroke="var(--color-muted)"
              fontSize={12}
              width={48}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ stroke: "var(--color-muted)", strokeDasharray: "3 3" }}
              contentStyle={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                color: "var(--color-text)",
              }}
              labelFormatter={(d) => `Week to ${formatDay(String(d))}`}
              formatter={(value, name) => [
                `${fmt(Math.round(Number(value)))} kcal`,
                name === "intake" ? "Average intake" : "Burn",
              ]}
            />
            <Line
              dataKey="intake"
              stroke={INTAKE}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)", fill: INTAKE }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="burn"
              stroke={BURN}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted">Show as a table</summary>
        <table className="tabular mt-2 w-full text-left">
          <thead className="text-muted">
            <tr>
              <th className="font-normal">Week to</th>
              <th className="font-normal">Intake</th>
              <th className="font-normal">Burn</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <td>{formatDay(r.day)}</td>
                <td>{r.intake == null ? "—" : fmt(r.intake)}</td>
                <td>{fmt(r.burn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** The adaptive TDEE ("burn") on the Targets page. */
export function TdeeBlock() {
  const tdee = useTdee();
  if (tdee.isPending) return <Spinner />;
  if (tdee.isError) {
    const needsData = tdee.error instanceof ApiError && tdee.error.status === 409;
    return (
      <div className="rounded-2xl bg-surface p-4 text-sm text-muted">
        {needsData
          ? `${tdee.error.message} to see your burn estimate.`
          : "Couldn't load your burn estimate."}
      </div>
    );
  }
  const t = tdee.data;
  const weekday = WEEKDAYS[t.check_in_weekday];
  return (
    <section aria-label="Burn estimate" className="space-y-3 rounded-2xl bg-surface p-4">
      <h2 className="font-medium">Burn (TDEE)</h2>
      {t.has_data ? (
        <>
          <p>
            <span className="readout text-2xl">{fmt(t.tdee)}</span>
            <span className="ml-1 text-sm text-muted">
              kcal a day{t.confidence != null && ` (±${t.confidence})`}
            </span>
          </p>
          <p className="text-sm text-muted">
            From your intake and weight trend over {t.eligible_days} logged days in the last 4
            weeks. Updated every {weekday}.
          </p>
        </>
      ) : (
        <>
          <p>
            <span className="readout text-2xl">{fmt(t.tdee)}</span>
            <span className="ml-1 text-sm text-muted">kcal a day, your starting estimate</span>
          </p>
          <p className="text-sm text-muted">
            {Math.min(t.eligible_days, MIN_DAYS)} of {MIN_DAYS} days logged so far. After two weeks
            of logging and weighing in, this switches to your measured burn.
          </p>
        </>
      )}
      {t.weekly.filter((w) => w.intake != null).length >= 2 && <IntakeVsBurn weeks={t.weekly} />}
    </section>
  );
}
