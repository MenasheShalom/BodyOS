import { z } from "zod";
import { ApiError } from "./api";

function parseNumber(raw: string, min: number, max: number, ctx: z.RefinementCtx): number {
  const n = Number(raw.replace(",", "."));
  if (Number.isNaN(n)) {
    ctx.addIssue({ code: "custom", message: "Enter a number" });
    return z.NEVER;
  }
  if (n < min || n > max) {
    ctx.addIssue({ code: "custom", message: `Must be between ${min} and ${max}` });
    return z.NEVER;
  }
  return n;
}

export const requiredNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1, "Required")
    .transform((v, ctx) => parseNumber(v, min, max, ctx));

export const optionalNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => (v === "" ? undefined : parseNumber(v, min, max, ctx)));

type SetError = (name: never, error: { message: string }) => void;

export function applyServerErrors(
  error: unknown,
  setError: SetError,
  knownFields: string[],
): string {
  if (error instanceof ApiError) {
    for (const [field, message] of Object.entries(error.fieldErrors)) {
      if (knownFields.includes(field)) setError(field as never, { message });
    }
    if (error.status === 0 || error.status >= 500) {
      return `${error.message} Your entry is still here.`;
    }
    return error.message;
  }
  return "Couldn't save. Your entry is still here, so try again.";
}
