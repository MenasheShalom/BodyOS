import { useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { AiSettingsSection } from "../components/ai/AiSettingsSection";
import { ConnectedApps } from "../components/ConnectedApps";
import { celebrationsOn, setCelebrations } from "../components/trophies/trophyMeta";
import { ProfileForm } from "../forms/ProfileForm";
import { useProfile, useSaveProfile } from "../lib/queries";
import { supabase } from "../lib/supabase";
import { setThemePref, type ThemePref, themePref } from "../lib/theme";

const THEMES: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function Settings() {
  const profile = useProfile();
  const save = useSaveProfile();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [celebrate, setCelebrate] = useState(celebrationsOn);
  const [theme, setTheme] = useState(themePref);
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
      <section aria-label="Appearance" className="space-y-2">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-2xl bg-surface p-1">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              onClick={() => {
                setTheme(value);
                setThemePref(value);
              }}
              className={`flex items-center justify-center gap-2 rounded-xl py-2 text-sm transition-colors ${theme === value ? "bg-accent font-medium text-bg" : "text-muted hover:text-text"}`}
            >
              <Icon size={16} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">System follows your device. Saved on this device.</p>
      </section>
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
