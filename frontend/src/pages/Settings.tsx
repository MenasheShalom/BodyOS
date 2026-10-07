import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AiSettingsSection } from "../components/ai/AiSettingsSection";
import { ConnectedApps } from "../components/ConnectedApps";
import { celebrationsOn, setCelebrations } from "../components/trophies/trophyMeta";
import { ProfileForm } from "../forms/ProfileForm";
import { useProfile, useSaveProfile } from "../lib/queries";
import { supabase } from "../lib/supabase";

export function Settings() {
  const profile = useProfile();
  const save = useSaveProfile();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [celebrate, setCelebrate] = useState(celebrationsOn);
  if (!profile.data) return null;
  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <ProfileForm
        initial={profile.data}
        showHiddenMetrics
        submitLabel="Save"
        onSubmit={async (p) => {
          setSaved(false);
          await save.mutateAsync(p);
          setSaved(true);
        }}
      />
      {saved && <p className="text-sm text-good">Saved.</p>}
      <AiSettingsSection />
      <ConnectedApps />
      <section aria-label="Trophies" className="space-y-2">
        <h2 className="text-lg font-semibold">Trophies</h2>
        <label className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
          <span>
            <span className="block">Celebrate new trophies</span>
            <span className="block text-sm text-muted">
              A full-screen card when you earn one (on this device)
            </span>
          </span>
          <input
            type="checkbox"
            checked={celebrate}
            onChange={(e) => {
              setCelebrate(e.target.checked);
              setCelebrations(e.target.checked);
            }}
            className="h-5 w-5 accent-[var(--color-accent)]"
          />
        </label>
      </section>
      <button
        type="button"
        onClick={() => void supabase.auth.signOut().then(() => qc.clear())}
        className="w-full rounded-xl border border-border py-3"
      >
        Sign out
      </button>
    </section>
  );
}
