import { useEffect, useState } from "react";
import { ErrorState, Spinner } from "../components/EmptyState";
import { TrophyBadge } from "../components/trophies/TrophyBadge";
import {
  CATEGORIES,
  earnedText,
  progressText,
  TIER_COLOR,
  TIER_LABEL,
} from "../components/trophies/trophyMeta";
import { useAchievements, useMarkAchievementsSeen } from "../lib/queries";
import type { Achievement, TrophyTier } from "../lib/types";

const TIERS: TrophyTier[] = ["gold", "silver", "bronze"];

function Row({ a, isNew }: { a: Achievement; isNew: boolean }) {
  const earned = a.earned_on !== null;
  const share = Math.min(1, a.progress / a.target);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <TrophyBadge achievement={a} size={44} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className={earned ? "font-medium" : "text-muted"}>{a.title}</span>
          {isNew && (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-bg">
              New
            </span>
          )}
        </p>
        <p className="text-sm text-muted">{a.description}</p>
        {earned ? (
          <p className="mt-0.5 text-xs">
            <span style={{ color: TIER_COLOR[a.tier] }}>{TIER_LABEL[a.tier]}</span>
            <span className="text-muted"> · {earnedText(a.earned_on!)}</span>
          </p>
        ) : (
          a.target > 1 && (
            <div className="mt-1.5 flex items-center gap-2">
              <div
                role="progressbar"
                aria-label={`${a.title} progress`}
                aria-valuemin={0}
                aria-valuemax={a.target}
                aria-valuenow={a.progress}
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
              >
                <div className="h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
              </div>
              <span className="tabular shrink-0 text-xs text-muted">{progressText(a)}</span>
            </div>
          )
        )}
      </div>
    </li>
  );
}

/** /trophies: earned and locked trophies, by category. */
export function Trophies() {
  const achievements = useAchievements();
  const markSeen = useMarkAchievementsSeen();
  // What was new when the page opened keeps its "New" chip for this visit; opening the page
  // counts as seeing them.
  const [newKeys, setNewKeys] = useState<Set<string> | null>(null);
  if (newKeys === null && achievements.data) {
    setNewKeys(new Set(achievements.data.filter((a) => a.new).map((a) => a.key)));
  }
  const { mutate } = markSeen;
  useEffect(() => {
    if (newKeys?.size) mutate([...newKeys]);
  }, [newKeys, mutate]);

  if (achievements.isPending) return <Spinner />;
  if (achievements.isError) return <ErrorState message={achievements.error.message} />;
  const all = achievements.data;
  const earned = all.filter((a) => a.earned_on !== null);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Trophies</h1>
        <p className="mt-1 text-sm text-muted">
          {earned.length} of {all.length} earned
          {TIERS.map((t) => {
            const n = earned.filter((a) => a.tier === t).length;
            return n ? (
              <span key={t}>
                {" · "}
                <span style={{ color: TIER_COLOR[t] }}>
                  {n} {TIER_LABEL[t].toLowerCase()}
                </span>
              </span>
            ) : null;
          })}
        </p>
      </div>
      {CATEGORIES.map(({ key, label }) => {
        const items = all
          .filter((a) => a.category === key)
          // earned first (newest first), then locked by how close they are
          .sort((a, b) =>
            a.earned_on && b.earned_on
              ? b.earned_on.localeCompare(a.earned_on)
              : a.earned_on
                ? -1
                : b.earned_on
                  ? 1
                  : b.progress / b.target - a.progress / a.target,
          );
        if (items.length === 0) return null;
        return (
          <section key={key} aria-label={label}>
            <h2 className="mb-2 font-medium">{label}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
              {items.map((a) => (
                <Row key={a.key} a={a} isNew={newKeys?.has(a.key) ?? a.new} />
              ))}
            </ul>
          </section>
        );
      })}
      <p className="text-xs text-muted">
        Body trophies use your trend, not single readings, so one lucky weigh-in doesn't count.
        Earned trophies stay earned.
      </p>
    </section>
  );
}
