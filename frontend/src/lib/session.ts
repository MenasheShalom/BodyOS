import { supabase } from "./supabase";

type Location = { pathname: string; search: string; assign: (url: string) => void };

/** Called when the API rejects our token: end this device's session and come back after sign-in.
 * Scope "local" so a server-side hiccup never revokes the user's sessions on other devices. */
export async function handleUnauthorized(location: Location = window.location): Promise<void> {
  if (location.pathname.startsWith("/sign-in")) return;
  const next = encodeURIComponent(location.pathname + location.search);
  try {
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    location.assign(`/sign-in?next=${next}`);
  }
}
