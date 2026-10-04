import { useAiSettings, useAiStatus, useSaveAiSettings } from "../../lib/queries";
import { providerName } from "./privacy";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });

/** Settings → AI: which provider is in use, this month's usage, and the on/off switch. */
export function AiSettingsSection() {
  const status = useAiStatus();
  const settings = useAiSettings();
  const save = useSaveAiSettings();
  if (!status.data || !settings.data) return null;
  const s = status.data;

  return (
    <section aria-label="AI" className="space-y-3">
      <h2 className="text-lg font-medium">AI</h2>
      {!s.configured ? (
        <p className="rounded-2xl bg-surface p-4 text-sm text-muted">
          AI features aren't set up on the server. See "AI features" in the README to choose a
          provider and add its API key.
        </p>
      ) : (
        <div className="space-y-3 rounded-2xl bg-surface p-4 text-sm">
          <label className="flex items-center justify-between gap-3">
            <span>Use AI features</span>
            <input
              type="checkbox"
              role="switch"
              checked={settings.data.enabled}
              disabled={save.isPending}
              onChange={(e) => save.mutate({ ...settings.data!, enabled: e.target.checked })}
              className="h-5 w-5 accent-[var(--color-accent)]"
            />
          </label>
          <p className="text-muted">
            {providerName(s.provider)}
            {s.model && <span className="tabular"> · {s.model}</span>}
          </p>
          <p className="tabular">
            {s.used_this_month} of {s.limit} requests used this month · resets{" "}
            {dateFmt.format(new Date(`${s.resets_on}T00:00:00`))}
          </p>
          {settings.data.acknowledged.length > 0 && (
            <button
              type="button"
              onClick={() => save.mutate({ ...settings.data!, acknowledged: [] })}
              className="text-accent"
            >
              Show privacy notices again
            </button>
          )}
        </div>
      )}
    </section>
  );
}
