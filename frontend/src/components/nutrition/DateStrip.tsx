import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import { addDays, dayLabel } from "../../lib/meals";

type Props = { day: string; today: string; onChange: (day: string) => void };

export function DateStrip({ day, today, onChange }: Props) {
  const touchX = useRef<number | null>(null);
  const canGoForward = day < today;
  const go = (delta: number) => {
    if (delta > 0 && !canGoForward) return;
    onChange(addDays(day, delta));
  };
  return (
    <div
      className="flex items-center justify-between rounded-2xl bg-surface px-2 py-1.5"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 60) go(dx > 0 ? -1 : 1);
      }}
    >
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => go(-1)}
        className="rounded-full p-2 text-muted"
      >
        <ChevronLeft size={20} />
      </button>
      <p className="font-medium" aria-live="polite">
        {dayLabel(day, new Date(`${today}T12:00:00`))}
      </p>
      <button
        type="button"
        aria-label="Next day"
        onClick={() => go(1)}
        disabled={!canGoForward}
        className="rounded-full p-2 text-muted disabled:opacity-30"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
