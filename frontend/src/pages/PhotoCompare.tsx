import { useMemo, useState } from "react";
import { CompareSlider } from "../components/CompareSlider";
import { EmptyState, Spinner } from "../components/EmptyState";
import { formatDay } from "../lib/format";
import { usePhotos } from "../lib/queries";
import type { Pose } from "../lib/types";

const select = "w-full rounded-xl border border-border bg-surface px-3 py-2";
const label = (iso: string) => formatDay(iso.slice(0, 10));

export function PhotoCompare() {
  const [pose, setPose] = useState<Pose>("front");
  const photos = usePhotos(pose);
  const sorted = useMemo(
    () => [...(photos.data ?? [])].sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1)),
    [photos.data],
  );
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const before = sorted.find((p) => p.id === beforeId) ?? sorted[0];
  const after = sorted.find((p) => p.id === afterId) ?? sorted[sorted.length - 1];

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Compare</h1>
      <select
        aria-label="Pose"
        className={select}
        value={pose}
        onChange={(e) => {
          setPose(e.target.value as Pose);
          setBeforeId(null);
          setAfterId(null);
        }}
      >
        <option value="front">Front</option>
        <option value="side">Side</option>
        <option value="back">Back</option>
      </select>
      {photos.isPending && <Spinner />}
      {sorted.length < 2 && !photos.isPending && (
        <EmptyState
          title="Need two photos of this pose"
          body="Add another photo to compare progress."
        />
      )}
      {sorted.length >= 2 && before && after && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="Before"
              className={select}
              value={before.id}
              onChange={(e) => setBeforeId(e.target.value)}
            >
              {sorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p.taken_at)}
                </option>
              ))}
            </select>
            <select
              aria-label="After"
              className={select}
              value={after.id}
              onChange={(e) => setAfterId(e.target.value)}
            >
              {sorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p.taken_at)}
                </option>
              ))}
            </select>
          </div>
          <CompareSlider
            beforeUrl={before.url}
            afterUrl={after.url}
            beforeLabel={label(before.taken_at)}
            afterLabel={label(after.taken_at)}
          />
        </>
      )}
    </section>
  );
}
