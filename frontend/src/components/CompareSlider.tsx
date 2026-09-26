import { useState } from "react";

type Props = { beforeUrl: string; afterUrl: string; beforeLabel: string; afterLabel: string };

export function CompareSlider({ beforeUrl, afterUrl, beforeLabel, afterLabel }: Props) {
  const [pos, setPos] = useState(50);
  return (
    <div>
      <div className="relative aspect-[3/4] select-none overflow-hidden rounded-2xl bg-surface-2">
        <img
          src={afterUrl}
          alt={`After: ${afterLabel}`}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <img
          src={beforeUrl}
          alt={`Before: ${beforeLabel}`}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/80"
          style={{ left: `${pos}%` }}
        />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {beforeLabel}
        </span>
        <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {afterLabel}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        aria-label="Compare position"
        onChange={(e) => setPos(Number(e.target.value))}
        className="mt-3 w-full accent-[var(--color-accent)]"
      />
    </div>
  );
}
