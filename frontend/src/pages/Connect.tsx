import { Check, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Spinner } from "../components/EmptyState";
import { ApiError } from "../lib/api";
import { useAnswerConsent, useConsentRequest } from "../lib/queries";

const CAN = [
  "Read your weigh-ins, body trends, goals and trophies",
  "Read your food log and nutrition targets",
  "Log weigh-ins and food for you",
];

/** /connect?request=…: allow or deny an AI assistant access to BodyOS (OAuth consent). */
export function Connect() {
  const [params] = useSearchParams();
  const id = params.get("request") ?? "";
  const request = useConsentRequest(id);
  const answer = useAnswerConsent();
  const [error, setError] = useState<string | null>(null);

  const respond = async (allow: boolean) => {
    setError(null);
    try {
      const { redirect_url } = await answer.mutateAsync({ id, allow });
      window.location.assign(redirect_url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <p className="readout mb-6 text-center text-lg">BodyOS</p>
      {!id ? (
        <p role="alert" className="rounded-2xl bg-surface p-5 text-center">
          This link is missing its request. Start connecting again from your assistant.
        </p>
      ) : request.isPending ? (
        <Spinner />
      ) : request.isError ? (
        <p role="alert" className="rounded-2xl bg-surface p-5 text-center">
          {request.error instanceof ApiError
            ? request.error.message
            : "Couldn't load this request. Try again."}
        </p>
      ) : (
        <section aria-label="Connect an app" className="space-y-5 rounded-2xl bg-surface p-5">
          <div className="flex items-center gap-3">
            <ShieldCheck size={28} className="shrink-0 text-accent" />
            <h1 className="text-lg font-semibold">
              {request.data.client_name} wants to connect to your BodyOS
            </h1>
          </div>
          <div>
            <p className="mb-2 text-sm text-muted">It will be able to:</p>
            <ul className="space-y-1.5 text-sm">
              {CAN.map((c) => (
                <li key={c} className="flex items-start gap-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-good" /> {c}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted">
            After you answer, you'll go back to{" "}
            <span className="font-medium text-text">{request.data.redirect_host}</span>. Only
            allow this if you started connecting there just now. You can disconnect any time in
            Settings.
          </p>
          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={answer.isPending}
              onClick={() => void respond(false)}
              className="flex-1 rounded-xl bg-surface-2 py-2.5 disabled:opacity-60"
            >
              Deny
            </button>
            <button
              type="button"
              disabled={answer.isPending}
              onClick={() => void respond(true)}
              className="flex-1 rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
            >
              Allow
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
