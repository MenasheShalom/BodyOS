import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Field } from "../components/Field";
import { localInputToIso, toLocalInputValue } from "../lib/format";
import { applyServerErrors, optionalNumber, requiredNumber } from "../lib/forms";
import { SCALE_FIELDS, WEIGHT } from "../lib/metrics";
import type { BodyEntry, BodyEntryInput, ScaleField } from "../lib/types";

const schema = z.object({
  measured_at: z.string().min(1, "Required"),
  weight_kg: requiredNumber(WEIGHT.min, WEIGHT.max),
  body_fat_pct: optionalNumber(2, 70),
  muscle_mass_kg: optionalNumber(5, 200),
  skeletal_muscle_pct: optionalNumber(5, 80),
  body_water_pct: optionalNumber(20, 80),
  bone_mass_kg: optionalNumber(0.5, 10),
  visceral_fat: optionalNumber(1, 60),
  protein_pct: optionalNumber(5, 30),
  bmr_kcal: optionalNumber(500, 5000),
  metabolic_age: optionalNumber(10, 100),
  note: z.string().max(500, "Keep notes under 500 characters"),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;
const KNOWN = Object.keys(schema.shape);

type Props = {
  hiddenMetrics: ScaleField[];
  lastValues?: Partial<Record<string, unknown>>;
  initial?: BodyEntry;
  submitLabel?: string;
  onSubmit: (payload: BodyEntryInput) => Promise<void>;
};

const str = (v: unknown) => (typeof v === "number" ? String(v) : "");

export function WeighInForm({
  hiddenMetrics,
  lastValues = {},
  initial,
  submitLabel = "Save weigh-in",
  onSubmit,
}: Props) {
  const visible = SCALE_FIELDS.filter((f) => !hiddenMetrics.includes(f.key));
  const [expanded, setExpanded] = useState(() => visible.some((f) => initial?.[f.key] != null));
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {
      measured_at: toLocalInputValue(initial ? new Date(initial.measured_at) : new Date()),
      weight_kg: str(initial?.weight_kg),
      ...Object.fromEntries(SCALE_FIELDS.map((f) => [f.key, str(initial?.[f.key])])),
      note: initial?.note ?? "",
    },
  });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    const payload = {
      measured_at: localInputToIso(values.measured_at),
      weight_kg: values.weight_kg,
      ...Object.fromEntries(SCALE_FIELDS.map((f) => [f.key, values[f.key] ?? null])),
      note: values.note.trim() || null,
    } as BodyEntryInput;
    try {
      await onSubmit(payload);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, KNOWN));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field
        label="Weight"
        unit="kg"
        inputMode="decimal"
        autoFocus
        placeholder={str(lastValues.weight_kg)}
        error={errors.weight_kg?.message}
        className="[&_input]:readout [&_input]:text-2xl"
        {...register("weight_kg")}
      />
      <Field
        label="Date & time"
        type="datetime-local"
        error={errors.measured_at?.message}
        {...register("measured_at")}
      />

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1 text-sm text-muted"
        aria-expanded={expanded}
      >
        More fields <ChevronDown size={16} className={expanded ? "rotate-180" : ""} />
      </button>
      {expanded && (
        <div className="grid grid-cols-2 gap-3">
          {visible.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              unit={f.unit}
              inputMode="decimal"
              placeholder={str(lastValues[f.key])}
              error={errors[f.key]?.message}
              {...register(f.key)}
            />
          ))}
          <Field
            className="col-span-2"
            label="Note"
            error={errors.note?.message}
            {...register("note")}
          />
        </div>
      )}

      {formError && (
        <p role="alert" className="text-sm text-bad">
          {formError}
        </p>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-xl bg-accent py-3 font-medium text-bg disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
