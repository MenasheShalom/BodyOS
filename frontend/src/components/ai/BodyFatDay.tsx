import { Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAiStatus, useDeleteBodyFat, useEstimateBodyFat } from "../../lib/queries";
import type { BodyFatEstimate, Photo } from "../../lib/types";
import { aiErrorMessage } from "./aiErrors";
import { photosForEstimate } from "./bodyFat";
import { PrivacyNotice } from "./PrivacyNotice";
import { usePrivacyGate } from "./privacy";

/** Under a day of progress photos: the AI body-fat estimate, or a button to make one. */
export function BodyFatDay({
  photos,
  estimate,
}: {
  photos: Photo[];
  estimate: BodyFatEstimate | undefined;
}) {
  const ai = useAiStatus();
  const create = useEstimateBodyFat();
  const remove = useDeleteBodyFat();
  const gate = usePrivacyGate("body_fat");
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    create.mutate(
      photosForEstimate(photos).map((p) => p.id),
      { onError: (e) => setError(aiErrorMessage(e)) },
    );
  };

  if (estimate) {
    return (
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setWhy(!why)} className="text-left">
            AI estimate:{" "}
            <span className="tabular font-medium">
              {estimate.low_pct}–{estimate.high_pct}%
            </span>{" "}
            <span className="text-muted">(rough)</span>
          </button>
          <button
            type="button"
            aria-label="Delete AI estimate"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm("Delete this AI estimate? The photos stay.")) {
                remove.mutate(estimate.id);
              }
            }}
            className="rounded-full p-1 text-muted"
          >
            <Trash2 size={16} />
          </button>
        </div>
        {why && estimate.notes && <p className="text-xs text-muted">{estimate.notes}</p>}
      </div>
    );
  }
  if (!ai.data?.enabled) return null;
  return (
    <div className="mt-2 space-y-1">
      <button
        type="button"
        disabled={create.isPending}
        onClick={() => (gate.needed ? setAsking(true) : run())}
        className="flex items-center gap-1.5 text-sm text-accent disabled:opacity-60"
      >
        <Sparkles size={16} />
        {create.isPending ? "Estimating…" : "Estimate body fat (AI)"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      {asking && (
        <PrivacyNotice
          what="these progress photos with your sex, age, height and weight"
          onContinue={async () => {
            await gate.accept();
            setAsking(false);
            run();
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}
