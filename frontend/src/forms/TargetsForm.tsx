import { type FormEvent, useState } from "react";
import { Field } from "../components/Field";
import { ApiError } from "../lib/api";
import type { MacroTargets } from "../lib/types";

const FIELDS: { key: keyof MacroTargets; label: string; unit: string; min: number; max: number }[] =
  [
    { key: "energy_kcal", label: "Calories", unit: "kcal", min: 800, max: 6000 },
    { key: "protein_g", label: "Protein", unit: "g", min: 0, max: 500 },
    { key: "carbs_g", label: "Carbs", unit: "g", min: 0, max: 1000 },
    { key: "fat_g", label: "Fat", unit: "g", min: 0, max: 400 },
    { key: "fiber_g", label: "Fibre", unit: "g", min: 0, max: 150 },
  ];

/** kcal implied by the macros (4 / 4 / 9 per gram). */
function macroKcal(t: Pick<MacroTargets, "protein_g" | "carbs_g" | "fat_g">): number {
  return 4 * t.protein_g + 4 * t.carbs_g + 9 * t.fat_g;
}

type Props = {
  initial: MacroTargets;
  submitLabel: string;
  onSubmit: (targets: MacroTargets) => Promise<void>;
};

export function TargetsForm({ initial, submitLabel, onSubmit }: Props) {
  const [values, setValues] = useState<Record<keyof MacroTargets, string>>(
    () =>
      Object.fromEntries(FIELDS.map((f) => [f.key, String(initial[f.key])])) as Record<
        keyof MacroTargets,
        string
      >,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof MacroTargets, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = Object.fromEntries(
    FIELDS.map((f) => [f.key, Math.round(Number(values[f.key].replace(",", ".")))]),
  ) as MacroTargets;
  const fromMacros = macroKcal(parsed);
  const offBy =
    parsed.energy_kcal > 0 ? Math.abs(fromMacros - parsed.energy_kcal) / parsed.energy_kcal : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs: typeof errors = {};
    for (const f of FIELDS) {
      const raw = values[f.key].trim();
      const n = parsed[f.key];
      if (!raw || Number.isNaN(n)) errs[f.key] = "Required";
      else if (n < f.min || n > f.max) errs[f.key] = `Must be between ${f.min} and ${f.max}`;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      await onSubmit(parsed);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            unit={f.unit}
            inputMode="numeric"
            value={values[f.key]}
            error={errors[f.key]}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
        ))}
      </div>
      {!Number.isNaN(fromMacros) && (
        <p className={`text-sm ${offBy > 0.05 ? "text-bad" : "text-muted"}`} role="status">
          Protein, carbs and fat add up to {fromMacros.toLocaleString("en-GB")} kcal
          {offBy > 0.05 ? ", more than 5% away from your calorie target." : "."}
        </p>
      )}
      {formError && (
        <p role="alert" className="text-sm text-bad">
          {formError}
        </p>
      )}
      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </form>
  );
}
