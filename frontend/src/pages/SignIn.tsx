import { type FormEvent, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";

export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

const input =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 outline-none focus:border-accent";

export function SignIn() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const { session } = useAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={next} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === "sign-in") {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (authError) return setError(authError.message);
      navigate(next, { replace: true });
    } else {
      const { data, error: authError } = await supabase.auth.signUp({ email, password });
      setBusy(false);
      if (authError) return setError(authError.message);
      if (!data.session) {
        return setNotice("Check your email to confirm your account, then sign in.");
      }
      navigate(next, { replace: true });
    }
  }

  async function google() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${next}` },
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="readout text-4xl">BodyOS</h1>
      <p className="mt-2 text-muted">Weight, composition and progress, as trends you can trust.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Email</span>
          <input
            className={input}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Password</span>
          <input
            className={input}
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
        {notice && <p className="text-sm text-good">{notice}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
        >
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => void google()}
        className="mt-3 w-full rounded-xl border border-border py-2.5"
      >
        Continue with Google
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        className="mt-6 text-sm text-muted underline"
      >
        {mode === "sign-in" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </main>
  );
}
