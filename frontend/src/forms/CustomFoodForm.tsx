import { ChevronDown, Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Field } from "../components/Field";
import { ApiError } from "../lib/api";
import { MACROS, NUTRIENTS } from "../lib/nutrients";
import type { CustomFoodInput, Food, NutrientKey, Nutrients } from "../lib/types";

type Basis = "100g" | "serving";
type Errors = Partial<Record<string, string>>;

const PRIMARY: NutrientKey[] = ["energy_kcal", ...MACROS];
const num = (raw: string): number | null => {
  const n = Number(raw.replace(",", "."));
  return raw.trim() === "" || Number.isNaN(n) ? null : n;
};
const str = (n: number | undefined) => (n == null ? "" : String(Math.round(n * 1000) / 1000));

type Props = {
  /** An existing custom food to edit, or a database food to copy into my foods. */
  initial?: Partial<Food>;
  editing?: boolean;
  onSubmit: (body: CustomFoodInput) => Promise<void>;
};

export function CustomFoodForm({ initial, editing = false, onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [barcode, setBarcode] = useState(initial?.barcode ?? "");
  const [isLiquid, setIsLiquid] = useState(initial?.is_liquid ?? false);
  const [basis, setBasis] = useState<Basis>(initial?.nutrients_per_100g ? "100g" : "serving");
  const [servingLabel, setServingLabel] = useState("1 serving");
  const [servingGrams, setServingGrams] = useState("");
  const [values, setValues] = useState<Partial<Record<NutrientKey, string>>>(() =>
    Object.fromEntries(
      Object.entries(initial?.nutrients_per_100g ?? {}).map(([k, v]) => [k, str(v)]),
    ),
  );
  const [extra, setExtra] = useState(
    (initial?.servings ?? []).map((s) => ({ label: s.label, grams: String(s.grams) })),
  );
  const [showMore, setShowMore] = useState(
    NUTRIENTS.some((n) => !PRIMARY.includes(n.key) && initial?.nutrients_per_100g?.[n.key] != null),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const unit = isLiquid ? "ml" : "g";

  const validate = (): CustomFoodInput | null => {
    const e: Errors = {};
    if (!name.trim()) e.name = "Required";
    if (barcode && !/^\d{6,14}$/.test(barcode)) e.barcode = "6 to 14 digits";
    const grams = num(servingGrams);
    if (basis === "serving" && (grams == null || grams <= 0 || grams > 5000)) {
      e.serving_grams = "Between 0 and 5000";
    }
    const scale = basis === "serving" && grams ? 100 / grams : 1;
    const nutrients: Nutrients = {};
    for (const n of NUTRIENTS) {
      const raw = values[n.key] ?? "";
      const v = num(raw);
      if (raw.trim() && (v == null || v < 0)) e[n.key] = "Enter a number";
      else if (v != null && v * scale > n.max) e[n.key] = `Too high (max ${n.max} per 100 ${unit})`;
      else if (v != null) nutrients[n.key] = v;
    }
    if (nutrients.energy_kcal == null && !e.energy_kcal) e.energy_kcal = "Required";
    const macroSum = MACROS.reduce((sum, k) => sum + (nutrients[k] ?? 0), 0) * scale;
    if (!e.protein_g && macroSum > 105) e.protein_g = `Protein, carbs and fat exceed 100 ${unit}`;
    const servings = extra
      .filter((s) => s.label.trim() || s.grams.trim())
      .map((s) => ({ label: s.label.trim(), grams: num(s.grams) ?? 0 }));
    if (servings.some((s) => !s.label || s.grams <= 0 || s.grams > 5000)) {
      e.servings = "Each serving needs a name and a weight up to 5000";
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return null;

    const common = {
      name: name.trim(),
      brand: brand.trim() || null,
      barcode: barcode || null,
      is_liquid: isLiquid,
    };
    if (basis === "100g") return { ...common, servings, nutrients_per_100g: nutrients };
    const label = servingLabel.trim() || `${grams} ${unit}`;
    return {
      ...common,
      servings: [{ label, grams: grams! }, ...servings.filter((s) => s.label !== label)],
      nutrients_per_serving: nutrients,
      serving_grams: grams!,
    };
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    const body = validate();
    if (!body) return;
    setSaving(true);
    try {
      await onSubmit(body);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const nutrientField = (key: NutrientKey) => {
    const n = NUTRIENTS.find((x) => x.key === key)!;
    return (
      <Field
        key={key}
        label={n.label}
        unit={n.unit}
        inputMode="decimal"
        value={values[key] ?? ""}
        error={errors[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
      />
    );
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      <div className="space-y-3 rounded-2xl bg-surface p-4">
        <Field
          label="Name"
          dir="auto"
          value={name}
          error={errors.name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Brand (optional)"
            dir="auto"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
          <Field
            label="Barcode (optional)"
            inputMode="numeric"
            value={barcode}
            error={errors.barcode}
            onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isLiquid}
            onChange={(e) => setIsLiquid(e.target.checked)}
          />
          It's a drink (measure in ml)
        </label>
      </div>

      <div className="space-y-3 rounded-2xl bg-surface p-4">
        <fieldset>
          <legend className="mb-2 text-sm text-muted">Nutrition values are</legend>
          <div role="radiogroup" className="flex gap-1 rounded-xl bg-surface-2 p-1">
            {(
              [
                ["serving", "Per serving"],
                ["100g", `Per 100 ${unit}`],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className={`flex-1 cursor-pointer rounded-lg px-3 py-1.5 text-center text-sm ${
                  basis === key ? "bg-surface shadow-sm" : "text-muted"
                }`}
              >
                <input
                  type="radio"
                  name="basis"
                  className="sr-only"
                  checked={basis === key}
                  onChange={() => setBasis(key)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {basis === "serving" && (
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Serving name"
              dir="auto"
              value={servingLabel}
              onChange={(e) => setServingLabel(e.target.value)}
            />
            <Field
              label="Serving size"
              unit={unit}
              inputMode="decimal"
              value={servingGrams}
              error={errors.serving_grams}
              onChange={(e) => setServingGrams(e.target.value)}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">{PRIMARY.map(nutrientField)}</div>
        <button
          type="button"
          onClick={() => setShowMore(!showMore)}
          aria-expanded={showMore}
          className="flex items-center gap-1 text-sm text-muted"
        >
          More nutrients <ChevronDown size={16} className={showMore ? "rotate-180" : ""} />
        </button>
        {showMore && (
          <div className="grid grid-cols-2 gap-3">
            {NUTRIENTS.filter((n) => !PRIMARY.includes(n.key)).map((n) => nutrientField(n.key))}
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-2xl bg-surface p-4">
        <p className="text-sm text-muted">Other servings (optional)</p>
        {extra.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
            <Field
              label="Name"
              dir="auto"
              value={s.label}
              onChange={(e) =>
                setExtra(extra.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
            />
            <Field
              label="Weight"
              unit={unit}
              inputMode="decimal"
              value={s.grams}
              onChange={(e) =>
                setExtra(extra.map((x, j) => (j === i ? { ...x, grams: e.target.value } : x)))
              }
            />
            <button
              type="button"
              aria-label={`Remove serving ${i + 1}`}
              onClick={() => setExtra(extra.filter((_, j) => j !== i))}
              className="mb-1 rounded-full p-2 text-muted"
            >
              <X size={18} />
            </button>
          </div>
        ))}
        {errors.servings && <p className="text-xs text-bad">{errors.servings}</p>}
        {extra.length < 9 && (
          <button
            type="button"
            onClick={() => setExtra([...extra, { label: "", grams: "" }])}
            className="flex items-center gap-1 text-sm text-accent"
          >
            <Plus size={16} /> Add a serving
          </button>
        )}
      </div>

      {editing && (
        <p className="text-sm text-muted">
          Changes apply to future logs. Past days keep what was logged.
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
        {editing ? "Save food" : "Create food"}
      </button>
    </form>
  );
}
