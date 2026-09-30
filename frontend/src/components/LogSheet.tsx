import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { MeasurementForm } from "../forms/MeasurementForm";
import { PhotoForm } from "../forms/PhotoForm";
import { WeighInForm } from "../forms/WeighInForm";
import { defaultMeal, isoDay } from "../lib/meals";
import { latestByPose, useUploadPhoto } from "../lib/photos";
import { bodyEntries, measurements, usePhotos, useProfile } from "../lib/queries";
import type { FoodTarget, LogTab } from "./AppLayout";
import { AddFood } from "./nutrition/AddFood";

const TABS: { key: LogTab; label: string }[] = [
  { key: "food", label: "Food" },
  { key: "weigh-in", label: "Weigh-in" },
  { key: "measurements", label: "Measurements" },
  { key: "photo", label: "Photo" },
];

type Props = { initialTab: LogTab; food?: FoodTarget; onClose: () => void };

export function LogSheet({ initialTab, food = {}, onClose }: Props) {
  const [tab, setTab] = useState<LogTab>(initialTab);
  const navigate = useNavigate();
  const [foodTarget] = useState(() => ({
    day: food.day ?? isoDay(new Date()),
    meal: food.meal ?? defaultMeal(new Date()),
  }));
  const profile = useProfile();
  const entries = bodyEntries.useList();
  const tapes = measurements.useList();
  const createEntry = bodyEntries.useCreate();
  const createMeasurement = measurements.useCreate();
  const photos = usePhotos();
  const upload = useUploadPhoto();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Log"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-bg p-5 md:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div role="tablist" className="flex gap-0.5 overflow-x-auto rounded-xl bg-surface-2 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm ${
                  tab === t.key ? "bg-surface text-text shadow-sm" : "text-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-2 text-muted"
          >
            <X size={20} />
          </button>
        </div>

        {tab === "food" && (
          <AddFood
            day={foodTarget.day}
            meal={foodTarget.meal}
            onDone={onClose}
            onCreateFood={(prefill) => {
              onClose();
              void navigate("/nutrition/foods/new", { state: { prefill } });
            }}
          />
        )}
        {tab === "weigh-in" && (
          <WeighInForm
            hiddenMetrics={profile.data?.hidden_metrics ?? []}
            lastValues={entries.data?.[0]}
            onSubmit={async (payload) => {
              await createEntry.mutateAsync(payload);
              onClose();
            }}
          />
        )}
        {tab === "measurements" && (
          <MeasurementForm
            sex={profile.data?.sex ?? "male"}
            lastValues={tapes.data?.[0]}
            onSubmit={async (payload) => {
              await createMeasurement.mutateAsync(payload);
              onClose();
            }}
          />
        )}
        {tab === "photo" && (
          <PhotoForm
            lastByPose={latestByPose(photos.data ?? [])}
            onSubmit={async (p) => {
              await upload.mutateAsync(p);
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}
