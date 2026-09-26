import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Field } from "../components/Field";
import { formatValue, localInputToIso, toLocalInputValue } from "../lib/format";
import { applyServerErrors, optionalNumber } from "../lib/forms";
import { TAPE_FIELDS } from "../lib/metrics";
import { useNavyPreview } from "../lib/queries";
import type { Measurement, MeasurementInput, Sex } from "../lib/types";

const tape = optionalNumber(10, 250);
const schema = z
  .object({
    measured_at: z.string().min(1, "Required"),
    waist_cm: tape,
    hips_cm: tape,
    chest_cm: tape,
    neck_cm: tape,
    arm_cm: tape,
    thigh_cm: tape,
    note: z.string().max(500, "Keep notes under 500 characters"),
  })
  .superRefine((v, ctx) => {
    if (TAPE_FIELDS.every((f) => v[f.key] === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["waist_cm"],
        message: "Enter at least one measurement",
      });
    }
  });
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;
const KNOWN = ["measured_at", "note", ...TAPE_FIELDS.map((f) => f.key)];

const toNum = (v: string | undefined) => {
  if (!v) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 10 && n <= 250 ? n : null;
};
const str = (v: unknown) => (typeof v === "number" ? String(v) : "");

type Props = {
  sex: Sex;
  lastValues?: Partial<Record<string, unknown>>;
  initial?: Measurement;
  submitLabel?: string;
  onSubmit: (payload: MeasurementInput) => Promise<void>;
};

export function MeasurementForm({
  sex,
  lastValues = {},
  initial,
  submitLabel = "Save measurements",
  onSubmit,
}: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {
      measured_at: toLocalInputValue(initial ? new Date(initial.measured_at) : new Date()),
      ...Object.fromEntries(TAPE_FIELDS.map((f) => [f.key, str(initial?.[f.key])])),
      note: initial?.note ?? "",
    },
  });
  const [waist, neck, hips] = useWatch({ control, name: ["waist_cm", "neck_cm", "hips_cm"] });
  const preview = useNavyPreview(
    toNum(waist),
    toNum(neck),
    sex === "female" ? toNum(hips) : null,
  );
  const navy = preview.data?.navy_body_fat_pct;

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    const payload = {
      measured_at: localInputToIso(values.measured_at),
      ...Object.fromEntries(TAPE_FIELDS.map((f) => [f.key, values[f.key] ?? null])),
      note: values.note.trim() || null,
    } as MeasurementInput;
    try {
      await onSubmit(payload);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, KNOWN));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {TAPE_FIELDS.map((f) => (
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
      </div>
      <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
        <span className="text-muted">US Navy body fat estimate: </span>
        {navy != null ? (
          <span className="tabular font-medium">{formatValue(navy, "%")}</span>
        ) : (
          <span className="text-muted">
            enter waist and neck{sex === "female" ? " and hips" : ""}
          </span>
        )}
      </div>
      <Field
        label="Date & time"
        type="datetime-local"
        error={errors.measured_at?.message}
        {...register("measured_at")}
      />
      <Field label="Note" error={errors.note?.message} {...register("note")} />
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
