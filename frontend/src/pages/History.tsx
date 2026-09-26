import { useState } from "react";
import { EmptyState, Spinner } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { MeasurementForm } from "../forms/MeasurementForm";
import { WeighInForm } from "../forms/WeighInForm";
import { formatDateTime, formatValue } from "../lib/format";
import { TAPE_FIELDS } from "../lib/metrics";
import { bodyEntries, measurements, useProfile } from "../lib/queries";
import type { BodyEntry, Measurement } from "../lib/types";

type Editing =
  | { kind: "entry"; item: BodyEntry }
  | { kind: "measurement"; item: Measurement }
  | null;

const row = "flex items-center justify-between gap-3 px-4 py-3";
const action = "rounded-lg bg-surface-2 px-2.5 py-1 text-xs";

export function History() {
  const [tab, setTab] = useState<"weigh-ins" | "measurements">("weigh-ins");
  const [editing, setEditing] = useState<Editing>(null);
  const profile = useProfile();
  const entries = bodyEntries.useList();
  const tapes = measurements.useList();
  const updateEntry = bodyEntries.useUpdate();
  const deleteEntry = bodyEntries.useDelete();
  const updateTape = measurements.useUpdate();
  const deleteTape = measurements.useDelete();

  const confirmDelete = (fn: () => void) => {
    if (window.confirm("Delete this entry? This can't be undone.")) fn();
  };

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">History</h1>
      <div role="tablist" className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {(["weigh-ins", "measurements"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-1.5 text-sm ${
              tab === t ? "bg-surface shadow-sm" : "text-muted"
            }`}
          >
            {t === "weigh-ins" ? "Weigh-ins" : "Measurements"}
          </button>
        ))}
      </div>

      {tab === "weigh-ins" && (
        <>
          {entries.isPending && <Spinner />}
          {entries.data?.length === 0 && <EmptyState title="No weigh-ins yet" />}
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {entries.data?.map((e) => {
              const when = formatDateTime(e.measured_at);
              return (
                <li key={e.id} className={row}>
                  <div>
                    <p className="tabular">
                      {formatValue(e.weight_kg, "kg")}
                      {e.body_fat_pct != null && (
                        <span className="text-muted">, {formatValue(e.body_fat_pct, "%")} fat</span>
                      )}
                    </p>
                    <p className="text-xs text-muted">{when}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={action}
                      aria-label={`Edit weigh-in from ${when}`}
                      onClick={() => setEditing({ kind: "entry", item: e })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={action}
                      aria-label={`Delete weigh-in from ${when}`}
                      onClick={() => confirmDelete(() => deleteEntry.mutate(e.id))}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === "measurements" && (
        <>
          {tapes.isPending && <Spinner />}
          {tapes.data?.length === 0 && <EmptyState title="No measurements yet" />}
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {tapes.data?.map((m) => {
              const when = formatDateTime(m.measured_at);
              return (
                <li key={m.id} className={row}>
                  <div>
                    <p className="tabular text-sm">
                      {TAPE_FIELDS.filter((f) => m[f.key] != null)
                        .map((f) => `${f.label} ${formatValue(m[f.key], "cm")}`)
                        .join(", ")}
                    </p>
                    <p className="text-xs text-muted">{when}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={action}
                      aria-label={`Edit measurements from ${when}`}
                      onClick={() => setEditing({ kind: "measurement", item: m })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={action}
                      aria-label={`Delete measurements from ${when}`}
                      onClick={() => confirmDelete(() => deleteTape.mutate(m.id))}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {editing?.kind === "entry" && (
        <Modal title="Edit weigh-in" onClose={() => setEditing(null)}>
          <WeighInForm
            hiddenMetrics={profile.data?.hidden_metrics ?? []}
            initial={editing.item}
            submitLabel="Save changes"
            onSubmit={async (body) => {
              await updateEntry.mutateAsync({ id: editing.item.id, body });
              setEditing(null);
            }}
          />
        </Modal>
      )}
      {editing?.kind === "measurement" && (
        <Modal title="Edit measurements" onClose={() => setEditing(null)}>
          <MeasurementForm
            sex={profile.data?.sex ?? "male"}
            initial={editing.item}
            submitLabel="Save changes"
            onSubmit={async (body) => {
              await updateTape.mutateAsync({ id: editing.item.id, body });
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
