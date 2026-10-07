import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAchievements, useMarkAchievementsSeen } from "../../lib/queries";
import type { Achievement } from "../../lib/types";
import { TrophyBadge } from "./TrophyBadge";
import {
  CELEBRATIONS_EVENT,
  celebrationsOn,
  SUMMARY_FROM,
  earnedText,
  TIER_COLOR,
  TIER_LABEL,
} from "./trophyMeta";


const CONFETTI_COLORS = [
  "var(--color-gold)",
  "var(--color-accent)",
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-bronze)",
  "var(--color-good)",
];

/** Deterministic scatter, so the pieces don't jump between renders. */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => {
        const r = (n: number) => ((i * 9301 + n * 49297) % 233280) / 233280;
        return {
          left: `${r(1) * 100}%`,
          width: 6 + r(2) * 6,
          height: 10 + r(3) * 8,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          style: {
            "--delay": `${r(4) * 0.9}s`,
            "--duration": `${2.4 + r(5) * 1.8}s`,
            "--drift": `${(r(6) - 0.5) * 160}px`,
            "--spin": `${360 + r(7) * 720}deg`,
          } as CSSProperties,
        };
      }),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece rounded-[2px]"
          style={{ ...p.style, left: p.left, width: p.width, height: p.height, background: p.color }}
        />
      ))}
    </div>
  );
}

function Shell({
  label,
  children,
  onClose,
}: {
  label: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/95 px-6 backdrop-blur-sm"
    >
      <Confetti />
      <div className="relative flex w-full max-w-sm flex-col items-center text-center">
        {children}
      </div>
    </div>
  );
}

function Single({
  achievement,
  position,
  last,
  onNext,
  onAll,
}: {
  achievement: Achievement;
  position: string | null;
  last: boolean;
  onNext: () => void;
  onAll: () => void;
}) {
  const color = TIER_COLOR[achievement.tier];
  return (
    <Shell label="Trophy earned" onClose={onNext}>
      <p
        className="animate-trophy-rise readout text-sm tracking-[0.2em] uppercase"
        style={{ color }}
      >
        Trophy earned{position ? ` · ${position}` : ""}
      </p>
      <div className="relative my-8">
        <span
          aria-hidden
          className="animate-trophy-glow absolute -inset-8 rounded-full blur-2xl"
          style={{ background: color }}
        />
        <span className="animate-trophy-pop relative block">
          <TrophyBadge achievement={achievement} size={132} />
        </span>
      </div>
      <h2 dir="auto" className="animate-trophy-rise readout text-3xl">
        {achievement.title}
      </h2>
      <p className="animate-trophy-rise mt-2 text-muted [animation-delay:120ms]">
        {achievement.description}
      </p>
      <p className="animate-trophy-rise mt-4 text-sm [animation-delay:200ms]">
        <span className="font-medium" style={{ color }}>
          {TIER_LABEL[achievement.tier]}
        </span>
        {achievement.earned_on && (
          <span className="text-muted"> · {earnedText(achievement.earned_on)}</span>
        )}
      </p>
      <div className="mt-10 flex w-full flex-col gap-2">
        <button
          type="button"
          autoFocus
          onClick={onNext}
          className="w-full rounded-xl bg-accent py-3 font-medium text-bg"
        >
          {last ? "Nice!" : "Next"}
        </button>
        <button type="button" onClick={onAll} className="w-full py-2 text-sm text-muted">
          See all trophies
        </button>
      </div>
    </Shell>
  );
}

function Summary({ achievements, onDone, onAll }: {
  achievements: Achievement[];
  onDone: () => void;
  onAll: () => void;
}) {
  const golds = achievements.filter((a) => a.tier === "gold").length;
  return (
    <Shell label="Trophies earned" onClose={onDone}>
      <p className="animate-trophy-rise readout text-sm tracking-[0.2em] text-[var(--color-gold)] uppercase">
        Trophies earned
      </p>
      <h2 className="animate-trophy-pop readout mt-4 text-5xl">{achievements.length}</h2>
      <p className="animate-trophy-rise mt-2 text-muted">
        Your history already earned these{golds ? `, including ${golds} gold` : ""}.
      </p>
      <ul
        aria-label="New trophies"
        className="animate-trophy-rise mt-8 grid max-h-[45dvh] w-full grid-cols-4 gap-3 overflow-y-auto [animation-delay:150ms]"
      >
        {achievements.map((a) => (
          <li key={a.key} className="flex flex-col items-center gap-1">
            <TrophyBadge achievement={a} size={52} />
            <span className="text-[11px] leading-tight">{a.title}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex w-full flex-col gap-2">
        <button
          type="button"
          autoFocus
          onClick={onAll}
          className="w-full rounded-xl bg-accent py-3 font-medium text-bg"
        >
          See my trophies
        </button>
        <button type="button" onClick={onDone} className="w-full py-2 text-sm text-muted">
          Later
        </button>
      </div>
    </Shell>
  );
}

/** Shows newly earned trophies full screen, one at a time, or as one summary card when many
 * arrive together. Mounted once in the app layout. */
export function TrophyCelebration() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [on, setOn] = useState(celebrationsOn);
  useEffect(() => {
    const sync = () => setOn(celebrationsOn());
    window.addEventListener(CELEBRATIONS_EVENT, sync);
    return () => window.removeEventListener(CELEBRATIONS_EVENT, sync);
  }, []);
  const achievements = useAchievements(on);
  const markSeen = useMarkAchievementsSeen();
  // Gold first, so the best news leads.
  const fresh = (achievements.data ?? [])
    .filter((a) => a.new)
    .sort((a, b) => tierRank(b) - tierRank(a));
  const [shown, setShown] = useState(0);

  // The trophies page shows new ones itself.
  if (!on || fresh.length === 0 || pathname === "/trophies") return null;
  const seen = (keys: string[]) => markSeen.mutate(keys);
  // The trophies page marks what's new as seen once it has shown it.
  const toTrophies = () => void navigate("/trophies");

  if (fresh.length >= SUMMARY_FROM) {
    const keys = fresh.map((a) => a.key);
    return (
      <Summary achievements={fresh} onDone={() => seen(keys)} onAll={toTrophies} />
    );
  }
  const current = fresh[0];
  const total = shown + fresh.length;
  return (
    <Single
      key={current.key}
      achievement={current}
      position={total > 1 ? `${shown + 1} of ${total}` : null}
      last={fresh.length === 1}
      onNext={() => {
        setShown((n) => n + 1);
        seen([current.key]);
      }}
      onAll={toTrophies}
    />
  );
}

const tierRank = (a: Achievement) => ({ bronze: 0, silver: 1, gold: 2 })[a.tier];
