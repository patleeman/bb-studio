// @bb-studio/applets — frontend entry: the settings page sections for the
// shell's state and each applet's capabilities.
import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { AppletRow, rpcContract } from "./contract";

type StatusResult = { root: string; shell: { state: string; appPath: string | null; version: string | null }; applets: AppletRow[] };

const SHELL_TEXT: Record<string, string> = {
  "not-installed": "Not installed. Applets need the Studio Applets app for macOS. Agents can still create and check them.",
  stopped: "Installed but not running.",
  running: "Running.",
};

const button =
  "rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useStatus() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    rpc.call("status", null).then(
      (next) => (setStatus(next), setError(null)),
      (cause) => setError(errorText(cause)),
    );
  }, [rpc]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { rpc, status, error, refresh };
}

function ShellSection() {
  const { status, error } = useStatus();
  const shell = status?.shell;
  return (
    <div className="py-3 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block size-2 rounded-full ${shell?.state === "running" ? "bg-emerald-500" : shell?.state === "stopped" ? "bg-amber-500" : "bg-muted-foreground/40"}`}
        />
        <span className="font-medium text-foreground">
          {shell ? SHELL_TEXT[shell.state] : error ? "Couldn't check the shell." : "Checking…"}
        </span>
        {shell?.version && <span className="text-xs text-muted-foreground">v{shell.version}</span>}
      </div>
      {status && <p className="mt-1 text-xs text-muted-foreground">Applets folder: {status.root}</p>}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function AppletItem({ applet, onChange }: { applet: AppletRow; onChange: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setError(null);
      onChange();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">
            {applet.name ?? applet.id}
            {applet.version && <span className="ml-2 text-xs font-normal text-muted-foreground">v{applet.version}</span>}
          </div>
          {applet.description && <div className="mt-0.5 text-xs text-muted-foreground">{applet.description}</div>}
        </div>
        <div className="flex gap-2">
          {applet.pending.length > 0 && (
            <button type="button" className={button} disabled={busy} onClick={() => run(() => rpc.call("applets.grant", { id: applet.id, capabilities: applet.pending }))}>
              Approve
            </button>
          )}
          {applet.granted.length > 0 && (
            <button type="button" className={button} disabled={busy} onClick={() => run(() => rpc.call("applets.revoke", { id: applet.id }))}>
              Revoke
            </button>
          )}
        </div>
      </div>
      {applet.capabilities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {applet.capabilities.map((capability) => {
            const waiting = applet.pending.includes(capability);
            return (
              <span
                key={capability}
                title={waiting ? "Waiting for your approval" : "Approved"}
                className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${waiting ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}
              >
                {capability}
              </span>
            );
          })}
        </div>
      )}
      {applet.errors.map((problem) => (
        <p key={problem} className="mt-1 text-xs text-destructive">{problem}</p>
      ))}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}

function AppletsSection() {
  const { status, refresh } = useStatus();
  if (!status) return <p className="py-3 text-xs text-muted-foreground">Loading…</p>;
  if (!status.applets.length)
    return <p className="py-3 text-xs text-muted-foreground">No applets yet. Ask an agent to make one, such as a HUD of your running threads.</p>;
  return (
    <ul className="divide-y divide-border">
      {status.applets.map((applet) => (
        <AppletItem key={applet.id} applet={applet} onChange={refresh} />
      ))}
    </ul>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "shell",
    title: "Studio Applets app",
    description: "Experimental. The signed macOS app that runs applets.",
    component: ShellSection,
  });
  app.slots.settingsSection({
    id: "applets",
    title: "Applets",
    description: "Applets your agents made. An applet can only use the capabilities you approve here.",
    component: AppletsSection,
  });
});
