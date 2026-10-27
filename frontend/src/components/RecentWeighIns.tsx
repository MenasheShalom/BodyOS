import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { WeighInForm } from "../forms/WeighInForm";
import { formatChange, formatDateTime, formatValue } from "../lib/format";
import { bodyEntries, useProfile } from "../lib/queries";
import type { BodyEntry } from "../lib/types";
import { Modal } from "./Modal";

const SHOWN = 5;

/** The latest weigh-ins on Home; tap one to fix or delete it. */
export function RecentWeighIns() {
  const entries = bodyEntries.useList();
  const update = bodyEntries.useUpdate();
  const remove = bodyEntries.useDelete();
  const profile = useProfile();
  const [editing, setEditing] = useState<BodyEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const recent = entries.data?.slice(0, SHOWN) ?? [];
  if (recent.length === 0) return null;

  async function deleteEditing() {
    if (!editing || !window.confirm("Delete this weigh-in? This can't be undone.")) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(editing.id);
      setEditing(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Couldn't delete. Please try again.");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-muted">Recent weigh-ins</h2>
        <Link to="/history" className="text-sm text-muted underline">
          See all
        </Link>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
        {recent.map((e, i) => {
          const when = formatDateTime(e.measured_at);
          // Entries are newest first, so the one after this is the weigh-in before it.
          const previous = entries.data?.[i + 1];
          return (
            <li key={e.id}>
              <button
                type="button"
                aria-label={`Edit weigh-in from ${when}`}
                onClick={() => {
                  setDeleteError(null);
                  setEditing(e);
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2"
              >
                <span>
                  <span className="tabular block">
                    <span>{formatValue(e.weight_kg, "kg")}</span>
                    {e.body_fat_pct != null && (
                      <span className="ml-2 text-muted">{formatValue(e.body_fat_pct, "%")} fat</span>
                    )}
                  </span>
                  <span className="block text-xs text-muted">{when}</span>
                </span>
                <span className="flex items-center gap-2">
                  {previous && (
                    <span className="tabular text-sm text-muted">
                      {formatChange(e.weight_kg - previous.weight_kg, "kg")}
                    </span>
                  )}
                  <ChevronRight size={18} className="text-muted" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {editing && (
        <Modal title="Edit weigh-in" onClose={() => setEditing(null)}>
          <WeighInForm
            hiddenMetrics={profile.data?.hidden_metrics ?? []}
            initial={editing}
            submitLabel="Save changes"
            onSubmit={async (body) => {
              await update.mutateAsync({ id: editing.id, body });
              setEditing(null);
            }}
          />
          {deleteError && (
            <p role="alert" className="mt-3 text-sm text-bad">
              {deleteError}
            </p>
          )}
          <button
            type="button"
            onClick={() => void deleteEditing()}
            className="mt-3 w-full rounded-xl border border-bad/50 py-3 font-medium text-bad"
          >
            Delete weigh-in
          </button>
        </Modal>
      )}
    </section>
  );
}
