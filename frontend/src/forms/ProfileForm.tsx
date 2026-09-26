import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Field } from "../components/Field";
import { applyServerErrors, requiredNumber } from "../lib/forms";
import { SCALE_FIELDS } from "../lib/metrics";
import type { Profile, ScaleField } from "../lib/types";

const today = () => new Date().toISOString().slice(0, 10);
const schema = z.object({
  height_cm: requiredNumber(100, 250),
  sex: z.enum(["male", "female"], { message: "Choose one" }),
  date_of_birth: z
    .string()
    .min(1, "Required")
    .refine((v) => v < today(), "Must be in the past"),
  timezone: z.string().min(1, "Required"),
  hidden_metrics: z.array(z.string()),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

type Props = {
  initial?: Profile;
  showHiddenMetrics?: boolean;
  submitLabel: string;
  onSubmit: (profile: Profile) => Promise<void>;
};

const TIMEZONES: string[] =
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

export function ProfileForm({ initial, showHiddenMetrics = false, submitLabel, onSubmit }: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {
      height_cm: initial ? String(initial.height_cm) : "",
      sex: initial?.sex,
      date_of_birth: initial?.date_of_birth ?? "",
      timezone: initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      hidden_metrics: initial?.hidden_metrics ?? [],
    },
  });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit({ ...values, hidden_metrics: values.hidden_metrics as ScaleField[] });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, Object.keys(schema.shape)));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field
        label="Height"
        unit="cm"
        inputMode="decimal"
        error={errors.height_cm?.message}
        {...register("height_cm")}
      />
      <fieldset>
        <legend className="mb-1 text-sm text-muted">
          Sex (used by the US Navy body-fat formula)
        </legend>
        <div className="flex gap-4">
          {(["male", "female"] as const).map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input type="radio" value={s} {...register("sex")} />{" "}
              {s === "male" ? "Male" : "Female"}
            </label>
          ))}
        </div>
        {errors.sex && <p className="mt-1 text-xs text-bad">{errors.sex.message}</p>}
      </fieldset>
      <Field
        label="Date of birth"
        type="date"
        error={errors.date_of_birth?.message}
        {...register("date_of_birth")}
      />
      <Field
        label="Timezone"
        list="bodyos-timezones"
        error={errors.timezone?.message}
        {...register("timezone")}
      />
      <datalist id="bodyos-timezones">
        {TIMEZONES.map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>

      {showHiddenMetrics && (
        <fieldset>
          <legend className="mb-2 text-sm text-muted">Hide scale fields you don't have</legend>
          <div className="grid grid-cols-2 gap-2">
            {SCALE_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" value={f.key} {...register("hidden_metrics")} /> {f.label}
              </label>
            ))}
          </div>
        </fieldset>
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
