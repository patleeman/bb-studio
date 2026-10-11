// The Kinds section of the Setup page: each kind built into Studio, on or
// off, and who opens and creates it when another plugin offers a
// replacement. See src/kinds.ts.
import { Button, cn, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@bb-studio/kit/ui";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { KindView, kindsContract, KindsState } from "../../kinds-contract";
import { needsWindowReload } from "../kinds-snapshot";

/** The Select's value for "automatic" (no stored choice). */
const AUTOMATIC = "automatic";

function KindRow({ view, busy, onChange }: { view: KindView; busy: boolean; onChange(change: { on?: boolean; use?: string | null }): void }) {
  const automaticLabel = view.alternatives.length === 1 ? `Automatic (${view.alternatives[0]!.name})` : "Automatic (Studio)";
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", view.on ? "text-foreground" : "text-muted-foreground")}>{view.label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{view.on ? "On" : "Off"}</span>
        <button
          type="button"
          role="switch"
          aria-checked={view.on}
          aria-label={`${view.label}: ${view.on ? "turn off" : "turn on"}`}
          disabled={busy}
          onClick={() => onChange({ on: !view.on })}
          className={cn(
            "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            view.on ? "bg-primary" : "bg-muted",
          )}
        >
          <span className={cn("inline-block size-3 rounded-full bg-background shadow transition-transform", view.on ? "translate-x-3.5" : "translate-x-0.5")} />
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {view.on ? view.covers : `Off: Studio hides its items, search results and New entries, and agents don't get its tools. Your ${view.label.toLowerCase()} are kept.`}
      </p>
      {view.alternatives.length ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs text-foreground">Open and create with</span>
          <Select value={view.choice ?? AUTOMATIC} disabled={busy} onValueChange={(value) => onChange({ use: value === AUTOMATIC ? null : value })}>
            <SelectTrigger className="h-8 w-56 text-xs" aria-label={`${view.label}: open and create with`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTOMATIC}>{automaticLabel}</SelectItem>
              <SelectItem value="studio">Studio</SelectItem>
              {view.alternatives.map((each) => <SelectItem key={each.pluginId} value={each.pluginId}>{each.name} ({each.label})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {view.alternatives.length && view.active.name !== "Studio" ? (
        <p className="text-xs text-muted-foreground">New {view.label.toLowerCase()} are made with {view.active.name}. {view.label} already in Studio still open there.</p>
      ) : null}
    </li>
  );
}

export function KindsSection() {
  const rpc = useRpc<typeof kindsContract>();
  const [state, setState] = useState<KindsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => rpc.call("kinds.state", null).then((next) => { setState(next); setError(null); }, (cause: unknown) => setError(errorMessage(cause))), [rpc]);
  useEffect(() => { void load(); }, [load]);
  useRealtime(STUDIO_REALTIME_CHANNEL, () => void load());
  const change = async (kind: string, update: { on?: boolean; use?: string | null }) => {
    setBusy(kind);
    try {
      setState(await rpc.call("kinds.update", { kind, ...update }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };
  const reload = state ? needsWindowReload(state.frontend) : false;
  return (
    <section className="flex flex-col gap-2" aria-label="Kinds">
      <h2 className="text-sm font-medium text-foreground">Kinds</h2>
      <p className="text-xs text-muted-foreground">
        What Studio makes. Turning one off hides it without deleting anything. A plugin that offers its own version of a kind can open and create it instead.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!state ? <p className="text-xs text-muted-foreground">Loading kinds…</p> : (
        <ul className="flex flex-col gap-2">
          {state.kinds.map((view) => <KindRow key={view.kind} view={view} busy={busy !== null} onChange={(update) => void change(view.kind, update)} />)}
        </ul>
      )}
      {reload ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 p-3">
          <p className="min-w-0 flex-1 text-xs text-foreground">Saved. Reload this window to update thread tabs, composer entries and reply cards. Agents use it from their next session.</p>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Reload window</Button>
        </div>
      ) : null}
    </section>
  );
}
