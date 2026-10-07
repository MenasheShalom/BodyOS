import { Lock } from "lucide-react";
import type { Achievement } from "../../lib/types";
import { CATEGORY_ICON, TIER_COLOR } from "./trophyMeta";

/** A round medal in the trophy's tier colour, greyed out with a lock while locked. */
export function TrophyBadge({
  achievement,
  size = 48,
}: {
  achievement: Pick<Achievement, "category" | "tier" | "earned_on">;
  size?: number;
}) {
  const Icon = CATEGORY_ICON[achievement.category];
  const earned = achievement.earned_on !== null;
  const color = earned ? TIER_COLOR[achievement.tier] : "var(--color-border)";
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: earned
          ? `radial-gradient(circle at 35% 30%, color-mix(in oklab, ${color} 35%, white), ${color} 70%)`
          : "var(--color-surface-2)",
        boxShadow: `inset 0 0 0 ${Math.max(2, size / 16)}px color-mix(in oklab, ${color} 70%, black)`,
      }}
    >
      <Icon
        size={size * 0.46}
        strokeWidth={2.2}
        className={earned ? "text-white drop-shadow" : "text-muted opacity-60"}
      />
      {!earned && (
        <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-surface p-0.5 text-muted">
          <Lock size={Math.max(10, size * 0.24)} />
        </span>
      )}
    </span>
  );
}
