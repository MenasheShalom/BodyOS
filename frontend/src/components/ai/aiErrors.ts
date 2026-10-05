import { ApiError } from "../../lib/api";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });

/** A user-facing message for a failed AI request. */
export function aiErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return "Something went wrong. Try again.";
  switch (e.code) {
    case "ai_limit": {
      const resets = typeof e.extra.resets_on === "string" ? e.extra.resets_on : null;
      return resets
        ? `You've used this month's AI requests. They reset on ${dateFmt.format(new Date(`${resets}T00:00:00`))}.`
        : "You've used this month's AI requests.";
    }
    case "ai_refused":
      return "This photo couldn't be analysed. Try another photo, or log the food by hand.";
    case "ai_unavailable":
      return "AI is unavailable right now. Try again in a minute, or log the food by hand.";
    case "ai_invalid_output":
      return "Couldn't read the AI's answer. Try again.";
    case "ai_disabled":
      return "AI features are switched off. You can turn them on in Settings.";
    case "ai_misconfigured":
      return e.message; // names the reason, e.g. an unknown model in AI_MODEL
    default:
      return e.message;
  }
}
