import { Camera, Database, Image as ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { resizeImage } from "../../lib/image";
import { eatenAtFor } from "../../lib/meals";
import { useFoodPhoto, useLogBatch } from "../../lib/queries";
import type { BatchEntry, FoodPhotoResult, Meal, Nutrients } from "../../lib/types";
import { FoodName } from "../nutrition/FoodName";
import { IngredientPicker } from "../nutrition/IngredientPicker";
import { aiErrorMessage } from "./aiErrors";
import { estimateName, MACROS, type Row, rowNutrients } from "./photoItems";
import { PrivacyNotice } from "./PrivacyNotice";
import { usePrivacyGate } from "./privacy";

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

type Props = { day: string; meal: Meal; onDone: () => void; onCancel: () => void };

/** Food photo → editable estimate list → log (spec §5.1). */
export function PhotoLog({ day, meal, onDone, onCancel }: Props) {
  const gate = usePrivacyGate("food_photo");
  const analyse = useFoodPhoto();
  const logBatch = useLogBatch();
  const [hint, setHint] = useState("");
  const [result, setResult] = useState<FoodPhotoResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [swapping, setSwapping] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!gate.ready) return null;
  if (gate.needed) {
    return (
      <PrivacyNotice
        what="your photo and any note you add"
        onContinue={gate.accept}
        onCancel={onCancel}
      />
    );
  }

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const image = await resizeImage(file, 1280, 0.8).catch(() => file);
      const res = await analyse.mutateAsync({ image, hint });
      setResult(res);
      setRows(
        res.items.map((item, key) => ({
          key,
          kind: "estimate",
          item,
          grams: item.grams,
          text: String(item.grams),
        })),
      );
    } catch (e) {
      setError(aiErrorMessage(e));
    }
  };

  const update = (key: number, change: (r: Row) => Row) =>
    setRows((prev) => prev.map((r) => (r.key === key ? change(r) : r)));

  const log = async () => {
    setError(null);
    const eaten_at = eatenAtFor(day, meal, new Date());
    const entries: BatchEntry[] = rows.map((r) =>
      r.kind === "food"
        ? {
            kind: "food",
            food_id: r.food.id,
            grams: r.grams,
            serving_label: null,
            serving_count: null,
            meal,
            eaten_at,
          }
        : {
            kind: "quick",
            name: estimateName(r.item.name, r.grams),
            nutrients: rowNutrients(r),
            meal,
            eaten_at,
            origin: "ai_photo",
          },
    );
    try {
      await logBatch.mutateAsync(entries);
      onDone();
    } catch (e) {
      setError(aiErrorMessage(e));
    }
  };

  if (analyse.isPending) {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted">
        Reading your photo…
      </p>
    );
  }

  if (!result) {
    return (
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-muted">Anything the photo doesn't show? (optional)</span>
          <input
            dir="auto"
            value={hint}
            maxLength={300}
            onChange={(e) => setHint(e.target.value)}
            placeholder="e.g. cooked in olive oil, about a cup of rice"
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5"
          />
        </label>
        <div className="flex gap-2">
          <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent py-3 font-medium text-bg">
            <Camera size={20} />
            Take photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Take photo"
              className="sr-only"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </label>
          {/* No `capture` here, so the phone offers the photo library. */}
          <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-surface-2 py-3 font-medium">
            <ImageIcon size={20} />
            Choose from gallery
            <input
              type="file"
              accept="image/*"
              aria-label="Choose from gallery"
              className="sr-only"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          AI estimates the foods and amounts. You can fix anything before it's logged.
        </p>
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
      </div>
    );
  }

  const totals = rows.map(rowNutrients).reduce((sum, n) => {
    for (const key of MACROS) sum[key] = (sum[key] ?? 0) + (n[key] ?? 0);
    return sum;
  }, {} as Nutrients);
  const retake = (
    <button
      type="button"
      onClick={() => {
        setResult(null);
        setRows([]);
      }}
      className="w-full rounded-xl bg-surface-2 py-2.5 text-sm"
    >
      Try another photo
    </button>
  );

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <div role="status" className="space-y-1 rounded-2xl bg-surface p-4 text-sm">
          <p>
            {result.items.length === 0
              ? "Couldn't recognise food in this photo."
              : "All items removed."}
          </p>
          {result.notes && <p className="text-muted">{result.notes}</p>}
        </div>
      ) : (
        <>
          {result.notes && <p className="text-sm text-muted">{result.notes}</p>}
          <ul aria-label="Foods in the photo" className="space-y-2">
            {rows.map((r) => {
              const n = rowNutrients(r);
              const name = r.kind === "food" ? r.food.name : r.item.name;
              return (
                <li key={r.key} className="space-y-2 rounded-2xl bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <FoodName name={name} brand={r.kind === "food" ? r.food.brand : null} />
                      <span className="text-xs text-muted">
                        {r.kind === "food"
                          ? "From the food database"
                          : r.item.confidence === "low"
                            ? "Rough estimate"
                            : r.item.confidence === "medium"
                              ? "Estimate"
                              : "Confident estimate"}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                      className="shrink-0 rounded-full p-1 text-muted"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={1}
                        max={2000}
                        aria-label={`Grams of ${name}`}
                        value={r.text}
                        onChange={(e) => {
                          const text = e.target.value;
                          const grams = Number(text.replace(",", "."));
                          update(r.key, (row) =>
                            grams > 0 && grams <= 2000 ? { ...row, text, grams } : { ...row, text },
                          );
                        }}
                        className="tabular w-20 rounded-lg border border-border bg-bg px-2 py-1"
                      />
                      g
                    </label>
                    <span className="tabular flex-1 text-right text-sm">
                      {fmt(n.energy_kcal ?? 0)} kcal · P {fmt(n.protein_g ?? 0)} · C{" "}
                      {fmt(n.carbs_g ?? 0)} · F {fmt(n.fat_g ?? 0)}
                    </span>
                  </div>
                  {r.kind === "estimate" && (
                    <button
                      type="button"
                      onClick={() => setSwapping(r)}
                      className="flex items-center gap-1 text-xs text-accent"
                    >
                      <Database size={14} /> Find in database
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="tabular text-right text-sm">
            Total {fmt(totals.energy_kcal ?? 0)} kcal · P {fmt(totals.protein_g ?? 0)} g
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      {rows.length > 0 && (
        <button
          type="button"
          disabled={logBatch.isPending}
          onClick={() => void log()}
          className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
        >
          Log {rows.length} {rows.length === 1 ? "item" : "items"}
        </button>
      )}
      {retake}
      {swapping && (
        <IngredientPicker
          title="Find in database"
          initialQuery={swapping.item.search_query}
          onClose={() => setSwapping(null)}
          onPick={(food) => {
            update(swapping.key, (row) => ({ ...row, kind: "food", food }));
            setSwapping(null);
          }}
        />
      )}
    </div>
  );
}
