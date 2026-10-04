import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AiSettingsSection } from "../components/ai/AiSettingsSection";
import { ProfileForm } from "../forms/ProfileForm";
import { useProfile, useSaveProfile } from "../lib/queries";
import { supabase } from "../lib/supabase";

export function Settings() {
  const profile = useProfile();
  const save = useSaveProfile();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
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
