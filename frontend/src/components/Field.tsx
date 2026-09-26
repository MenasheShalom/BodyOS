import { type InputHTMLAttributes, type Ref, useId } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  unit?: string;
  error?: string;
  hint?: string;
  ref?: Ref<HTMLInputElement>;
};

export function Field({ label, unit, error, hint, id, className, ref, ...input }: Props) {
  const generated = useId();
  const inputId = id ?? generated;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1 block text-sm text-muted">
        {label}
      </label>
      <div
        className={`flex items-center rounded-xl border bg-surface px-3 ${
          error ? "border-bad" : "border-border focus-within:border-accent"
        }`}
      >
        <input
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="tabular w-full bg-transparent py-2.5 outline-none placeholder:text-muted/60"
          {...input}
        />
        {unit && <span className="ml-2 text-sm text-muted">{unit}</span>}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-xs text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
