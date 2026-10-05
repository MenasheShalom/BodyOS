import { useState } from "react";
import { useAiStatus } from "../../lib/queries";
import { Modal } from "../Modal";
import { providerName } from "./privacy";

/** Shown once per feature, before anything is sent to the AI provider. */
export function PrivacyNotice({
  what,
  detail = "Food photos aren't stored by BodyOS. AI estimates can be wrong, so check the amounts.",
  onContinue,
  onCancel,
}: {
  /** What gets sent, e.g. "your photo and any note you add". */
  what: string;
  /** What the user should know about this feature's results. */
  detail?: string;
  onContinue: () => void | Promise<unknown>;
  onCancel: () => void;
}) {
  const status = useAiStatus();
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Before you use AI" onClose={onCancel}>
      <div className="space-y-4 text-sm">
        <p>
          To do this, BodyOS sends {what} to {providerName(status.data?.provider ?? null)}. Nothing
          is saved or logged until you check the result and confirm it.
        </p>
        <p className="text-muted">
          {detail} You can switch AI features off in Settings.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-surface-2 py-2.5"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onContinue();
              } finally {
                setBusy(false);
              }
            }}
            className="flex-1 rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
          >
            Continue
          </button>
        </div>
      </div>
    </Modal>
  );
}
