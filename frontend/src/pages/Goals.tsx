import { useState } from "react";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { GoalProgress } from "../components/GoalProgress";
import { Modal } from "../components/Modal";
import { GoalForm } from "../forms/GoalForm";
import { formatValue } from "../lib/format";
import { GOAL_METRICS, metricInfo } from "../lib/metrics";
import { goals } from "../lib/queries";
import type { Goal } from "../lib/types";

const btn = "rounded-lg bg-surface px-2.5 py-1 text-xs";
const STATUS_LABEL = { active: "Active", achieved: "Achieved", archived: "Archived" } as const;

export function Goals() {
  const [editing, setEditing] = useState<Goal | null>(null);
  const list = goals.useList();
  const create = goals.useCreate();
  const update = goals.useUpdate();
  const remove = goals.useDelete();
  if (list.isPending) return <Spinner />;
  if (list.isError) {
    return <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />;
  }

  const active = list.data.filter((g) => g.status === "active");
  const past = list.data.filter((g) => g.status !== "active");
  const taken = new Set(active.map((g) => g.metric));
  const confirmDelete = (id: string) => {
    if (window.confirm("Delete this goal?")) remove.mutate(id);
  };

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Goals</h1>
      <GoalForm
        availableMetrics={GOAL_METRICS.filter((m) => !taken.has(m.key))}
        onSubmit={async (input) => {
          await create.mutateAsync(input);
        }}
      />

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Active</h2>
        {active.length === 0 && (
          <EmptyState title="No active goals" body="Pick a metric above to set a target." />
        )}
        {active.map((g) => (
          <div key={g.id} className="space-y-2">
            <GoalProgress goal={g} />
            <div className="flex gap-2">
              <button type="button" className={btn} onClick={() => setEditing(g)}>
                Edit
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => update.mutate({ id: g.id, body: { status: "achieved" } })}
              >
                Mark achieved
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => update.mutate({ id: g.id, body: { status: "archived" } })}
              >
                Archive
              </button>
              <button type="button" className={btn} onClick={() => confirmDelete(g.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <Modal title="Edit goal" onClose={() => setEditing(null)}>
          <GoalForm
            availableMetrics={GOAL_METRICS}
            initial={{
              metric: editing.metric,
              target_value: editing.target_value,
              target_date: editing.target_date,
            }}
            onSubmit={async ({ target_value, target_date }) => {
              await update.mutateAsync({ id: editing.id, body: { target_value, target_date } });
              setEditing(null);
            }}
          />
        </Modal>
      )}

      {past.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted">Past</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {past.map((g) => {
              const info = metricInfo(g.metric);
              return (
                <li key={g.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>
                    {info.label} to {formatValue(g.target_value, info.unit)}{" "}
                    <span className="text-muted">({STATUS_LABEL[g.status]})</span>
                  </span>
                  <button type="button" className={btn} onClick={() => confirmDelete(g.id)}>
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
