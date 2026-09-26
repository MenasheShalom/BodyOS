import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Field } from "../components/Field";
import { applyServerErrors, requiredNumber } from "../lib/forms";
import type { GoalInput, GoalMetric } from "../lib/types";

const schema = z.object({
  metric: z.string().min(1, "Choose a metric"),
  target_value: requiredNumber(0.1, 10000),
  target_date: z.string(),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

type Props = {
  availableMetrics: { key: GoalMetric; label: string; unit: string }[];
  /** Editing an existing goal: the metric is fixed, only target and date change. */
  initial?: GoalInput;
  onSubmit: (input: GoalInput) => Promise<void>;
};

export function GoalForm({ availableMetrics, initial, onSubmit }: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {
      metric: initial?.metric ?? "",
      target_value: initial ? String(initial.target_value) : "",
      target_date: initial?.target_date ?? "",
    },
  });
  const metric = useWatch({ control, name: "metric" });
  const unit = availableMetrics.find((m) => m.key === (initial?.metric ?? metric))?.unit;

  if (!initial && availableMetrics.length === 0) {
    return <p className="text-sm text-muted">Every goal metric already has an active goal.</p>;
  }

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await onSubmit({
        // A disabled select isn't submitted, so editing keeps the original metric.
        metric: initial?.metric ?? (v.metric as GoalMetric),
        target_value: v.target_value,
        target_date: v.target_date || null,
      });
      if (!initial) reset();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ["metric", "target_value", "target_date"]));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-2xl bg-surface p-4">
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Metric</span>
        <select
          className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 disabled:opacity-70"
          disabled={!!initial}
          {...register("metric")}
        >
          <option value="">Choose…</option>
          {availableMetrics.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        {errors.metric && (
          <span className="mt-1 block text-xs text-bad">{errors.metric.message}</span>
        )}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Target"
          unit={unit}
          inputMode="decimal"
          error={errors.target_value?.message}
          {...register("target_value")}
        />
        <Field
          label="By (optional)"
          type="date"
          error={errors.target_date?.message}
          {...register("target_date")}
        />
      </div>
      {formError && (
        <p role="alert" className="text-sm text-bad">
          {formError}
        </p>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
      >
        {initial ? "Save goal" : "Add goal"}
      </button>
    </form>
  );
}
