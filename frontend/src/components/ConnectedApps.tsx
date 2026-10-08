import { useState } from "react";
import { env } from "../lib/env";
import { useConnectedApps, useDisconnectApp } from "../lib/queries";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Settings: AI assistants connected over MCP, and how to connect one. */
export function ConnectedApps() {
  const apps = useConnectedApps();
  const disconnect = useDisconnectApp();
  const [copied, setCopied] = useState(false);
  const url = `${env.apiUrl.replace(/\/$/, "")}/mcp`;

  return (
    <section aria-label="Connected apps" className="space-y-3">
      <h2 className="text-lg font-semibold">Connected apps</h2>
      <div className="space-y-2 rounded-2xl bg-surface p-4 text-sm">
        <p>
          Connect Claude (or another AI assistant) to read your data and log for you. In Claude,
          add a custom connector with this URL, then sign in here when asked:
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-surface-2 px-2 py-1.5 text-xs">{url}</code>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => {})
            }
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {apps.data && apps.data.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
          {apps.data.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block">{a.client_name}</span>
                <span className="block text-xs text-muted">
                  Connected {dateFmt.format(new Date(a.created_at))}
                  {a.last_used_at ? ` · last used ${dateFmt.format(new Date(a.last_used_at))}` : ""}
                </span>
              </span>
              <button
                type="button"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate(a.id)}
                className="text-sm text-bad"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
