import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type ChartRow, mergeSeries, yDomain } from "../../lib/chart";
import { formatDay, formatValue } from "../../lib/format";
import type { Series } from "../../lib/types";

const C1 = "var(--color-series-1)";
const C2 = "var(--color-series-2)";

type Props = { primary: Series; secondary?: Series; goalValue?: number | null };

type PanelProps = {
  rows: ChartRow[];
  series: Series;
  rawKey: "raw" | "raw2";
  trendKey: "trend" | "trend2";
  color: string;
  goalValue?: number | null;
  compact?: boolean;
};

function Legend({ series, color, goal }: { series: Series; color: string; goal: boolean }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span className="font-medium text-text">{series.label}</span>
      <span className="flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden="true">
          <circle cx="5" cy="5" r="4" fill={color} fillOpacity={0.35} />
        </svg>
        Readings
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="16" height="10" aria-hidden="true">
          <line x1="0" y1="5" x2="16" y2="5" stroke={color} strokeWidth={2} />
        </svg>
        Trend
      </span>
      {goal && (
        <span className="flex items-center gap-1.5">
          <svg width="16" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="16" y2="5" stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
          </svg>
          Goal
        </span>
      )}
    </div>
  );
}

function Panel({ rows, series, rawKey, trendKey, color, goalValue, compact }: PanelProps) {
  const values = [...series.points, ...series.trend].map((p) => p.value);
  return (
    <figure>
      <Legend series={series} color={color} goal={goalValue != null} />
      <div className={compact ? "h-48 md:h-64" : "h-72 md:h-96"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDay}
              stroke="var(--color-muted)"
              fontSize={12}
              minTickGap={24}
              tickLine={false}
            />
            <YAxis
              domain={yDomain(values, goalValue)}
              allowDecimals
              stroke="var(--color-muted)"
              fontSize={12}
              width={44}
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
              labelFormatter={(d) => formatDay(String(d))}
              formatter={(value, name) => [
                formatValue(Number(value), series.unit, 2),
                String(name).startsWith("trend") ? "Trend" : "Reading",
              ]}
            />
            <Scatter
              dataKey={rawKey}
              fill={color}
              fillOpacity={0.35}
              isAnimationActive={false}
            />
            <Line
              dataKey={trendKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
            />
            {goalValue != null && (
              <ReferenceLine y={goalValue} stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** One metric per chart. With a comparison metric, two panels share the same dates
 * instead of a dual-axis chart. */
export function TrendChart({ primary, secondary, goalValue }: Props) {
  const rows = mergeSeries(primary, secondary);
  return (
    <div className="space-y-6">
      <Panel
        rows={rows}
        series={primary}
        rawKey="raw"
        trendKey="trend"
        color={C1}
        goalValue={goalValue}
        compact={!!secondary}
      />
      {secondary && (
        <Panel rows={rows} series={secondary} rawKey="raw2" trendKey="trend2" color={C2} compact />
      )}
    </div>
  );
}
