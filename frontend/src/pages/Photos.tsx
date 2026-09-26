import { useState } from "react";
import { Link } from "react-router";
import { useLogSheet } from "../components/AppLayout";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { formatDay } from "../lib/format";
import { useDeletePhoto, usePhotos } from "../lib/queries";
import type { Photo, Pose } from "../lib/types";

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function groupByDay(photos: Photo[]): { day: string; photos: Photo[] }[] {
  const map = new Map<string, Photo[]>();
  for (const p of photos) {
    const day = localDay(p.taken_at);
    map.set(day, [...(map.get(day) ?? []), p]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, list]) => ({ day, photos: list }));
}

const FILTERS: { key: Pose | undefined; label: string }[] = [
  { key: undefined, label: "All" },
  { key: "front", label: "Front" },
  { key: "side", label: "Side" },
  { key: "back", label: "Back" },
];

export function Photos() {
  const [pose, setPose] = useState<Pose | undefined>(undefined);
  const [open, setOpen] = useState<Photo | null>(null);
  const photos = usePhotos(pose);
  const remove = useDeletePhoto();
  const logSheet = useLogSheet();

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Photos</h1>
        <Link to="/photos/compare" className="rounded-xl bg-surface px-3 py-1.5 text-sm">
          Compare
        </Link>
      </div>
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={pose === f.key}
            onClick={() => setPose(f.key)}
            className={`rounded-full px-3 py-1 text-sm ${
              pose === f.key ? "bg-text text-bg" : "bg-surface text-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {photos.isPending && <Spinner />}
      {photos.isError && (
        <ErrorState message={photos.error.message} onRetry={() => void photos.refetch()} />
      )}
      {photos.data?.length === 0 && (
        <EmptyState
          title="No photos yet"
          body="Front, side and back photos every few weeks make progress visible."
          action={
            <button
              type="button"
              onClick={() => logSheet.open("photo")}
              className="rounded-xl bg-accent px-4 py-2 text-bg"
            >
              Add a photo
            </button>
          }
        />
      )}
      {photos.data &&
        groupByDay(photos.data).map((group) => (
          <div key={group.day}>
            <h2 className="mb-2 text-sm text-muted">{formatDay(group.day)}</h2>
            <div className="grid grid-cols-3 gap-2">
              {group.photos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setOpen(p)}
                  className="aspect-[3/4] overflow-hidden rounded-xl bg-surface-2"
                >
                  <img
                    src={p.url}
                    alt={`${p.pose} photo`}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        ))}

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          onClick={() => setOpen(null)}
        >
          <img
            src={open.url}
            alt={`${open.pose} photo, full size`}
            className="max-h-[80dvh] rounded-xl object-contain"
          />
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded-xl bg-surface px-4 py-2"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Delete this photo? This can't be undone.")) {
                  remove.mutate(open.id, { onSuccess: () => setOpen(null) });
                }
              }}
              className="rounded-xl bg-bad px-4 py-2 text-white"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
