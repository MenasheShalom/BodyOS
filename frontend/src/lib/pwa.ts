import { registerSW } from "virtual:pwa-register";

const HOURLY = 60 * 60 * 1000;

/** Keeps the installed app current. A new deploy is picked up when the app is opened or
 * brought back to the foreground (and hourly while open); once the new version has
 * installed, the page reloads itself onto it. */
export function registerAppUpdates(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => {});
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      setInterval(check, HOURLY);
    },
  });
}
