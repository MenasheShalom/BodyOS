import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import type { Point } from "../../lib/types";

export function Sparkline({ points, color = "var(--color-accent)" }: { points: Point[]; color?: string }) {
  return (
    <div className="mt-3 h-10" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
