import type { Fallback } from "../../kit/decisions-legacy-contract";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  type PluginAppBuilder,
  experimental_ProviderModelPicker as ProviderModelPicker,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { Button } from "../../kit/ui/index";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../kit/ui/index";
import type { rpcContract } from "../contract";

import { errorMessage as errorText } from "../../kit/format";

/** Matches the host-rendered settings rows above: copy on the left, control on the right. */
function Row({ label, description, children }: { label: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 sm:max-w-[60%]">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">{children}</div>
    </div>
  );
}

function JevConnection() {
  const rpc = useRpc<typeof rpcContract>();
  const { values } = useSettings();
  const [status, setStatus] = useState<{ provider: string; routes: { name: string; model: string }[]; problems: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [check, setCheck] = useState<{ state: "idle" | "running" } | { state: "done"; text: string; ok: boolean }>({
    state: "idle",
  });

  // Secret keys are not in `values`, so also refresh after a check and on focus.
  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void rpc.call("decisions.jev.status", null).then(setStatus, (cause) => setError(errorText(cause))).finally(() => setLoading(false));
  }, [rpc]);
  useEffect(refresh, [refresh, JSON.stringify(values)]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const test = async () => {
    setCheck({ state: "running" });
    try {
      const result = await rpc.call("decisions.jev.check", null);
      setCheck(
        result.ok
          ? { state: "done", ok: true, text: `Jev answered through ${result.via} in ${result.ms} ms.` }
          : { state: "done", ok: false, text: result.error },
      );
    } catch (error) {
      setCheck({ state: "done", ok: false, text: errorText(error) });
    }
    refresh();
  };

  const routes = status?.routes ?? [];
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card px-4">
      <Row
        label={status?.provider === "auto" || !status ? "Providers auto will try" : "Provider"}
        description="Only providers with a key, or a complete custom endpoint, are used. Keys stay on the server."
      >
        {error ? (
          <><p role="alert" className="text-xs text-destructive">{error}</p><Button size="sm" variant="outline" onClick={refresh}>Retry</Button></>
        ) : loading ? <span className="text-sm text-muted-foreground">Loading…</span> : routes.length ? (
          <ol className="flex flex-col items-start gap-1 text-sm sm:items-end" aria-label="Jev providers in order">
            {routes.map((route, index) => (
              <li key={route.name} className="text-foreground">
                <span className="text-muted-foreground">{index + 1}.</span> {route.name}{" "}
                <span className="text-muted-foreground">· {route.model}</span>
              </li>
            ))}
          </ol>
        ) : (
          <span className="text-sm text-muted-foreground">None configured</span>
        )}
        {status?.problems.map((problem) => (
          <p key={problem} className="text-xs text-destructive">
            {problem}
          </p>
        ))}
      </Row>
      <Row label="Test connection" description="Sends a fixed sample message to Jev. It never reads a thread.">
        <Button size="sm" variant="outline" disabled={!routes.length || check.state === "running"} onClick={test}>
          {check.state === "running" ? "Testing…" : "Test"}
        </Button>
        {check.state === "done" && (
          <p role="status" className={check.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {check.text}
          </p>
        )}
      </Row>
    </div>
  );
}

const modeLabels = {
  thread: "The thread's provider",
  model: "A specific model",
  off: "Off",
} as const;

function FallbackModel() {
  const rpc = useRpc<typeof rpcContract>();
  const [value, setValue] = useState<Fallback | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [suggestionFailed, setSuggestionFailed] = useState(false);
  const refresh = useCallback(() => {
    setError(null);
    void rpc.call("decisions.fallback.get", null).then(setValue, (cause) => setError(errorText(cause)));
  }, [rpc]);
  useEffect(refresh, [refresh]);

  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setSuggestionFailed(false);
    try { await action(); } finally { pending.current = false; setBusy(false); }
  };

  const persist = async (next: Fallback) => {
    const previous = value;
    setValue(next);
    setError(null);
    try {
      setValue(await rpc.call("decisions.fallback.set", next));
    } catch (cause) {
      setValue(previous);
      setError(errorText(cause));
    }
  };

  const save = (next: Fallback) => run(() => persist(next));
  const chooseMode = (mode: Fallback["mode"]) => run(async () => {
    if (mode !== "model") return persist({ mode });
    // Start from a real catalog entry so the picker never shows an empty model.
    try {
      const suggestion = await rpc.call("decisions.fallback.suggest", null);
      if (!suggestion) return setError("No available provider has a model to choose.");
      await persist(suggestion);
    } catch (cause) {
      setError(errorText(cause));
      setSuggestionFailed(true);
    }
  });

  if (!value) return <div><p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>{error && <Button size="sm" variant="outline" onClick={refresh}>Retry</Button>}</div>;
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card px-4">
      <Row
        label="Use"
        description="Decides when no Jev provider answers, in a hidden thread that is deleted afterwards. Off sends every undecided Smart Queue message as a follow-up."
      >
        <Select disabled={busy} value={value.mode} onValueChange={(mode) => void chooseMode(mode as Fallback["mode"])}>
          <SelectTrigger className="w-56" aria-label="Fallback model source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(modeLabels) as Fallback["mode"][]).map((mode) => (
              <SelectItem key={mode} value={mode}>
                {modeLabels[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {value.mode === "thread" && (
        <Row label="Model" description="The caller's provider with its default model and lowest reasoning level: the busy thread's for Smart Queue.">
          <span className="text-sm text-muted-foreground">Matches each thread</span>
        </Row>
      )}
      {value.mode === "model" && (
        <Row label="Model" description="Pick a fast, inexpensive model. A classifier needs little reasoning.">
          <ProviderModelPicker
            disabled={busy}
            align="end"
            value={{
              providerId: value.providerId,
              model: value.model,
              reasoningLevel: value.reasoningLevel ?? "low",
              serviceTier: value.serviceTier,
            }}
            onChange={(next) =>
              void save({
                mode: "model",
                providerId: next.providerId,
                model: next.model,
                reasoningLevel: next.reasoningLevel,
                ...(next.serviceTier ? { serviceTier: next.serviceTier } : {}),
              })
            }
          />
        </Row>
      )}
      {error && <p role="alert" className="py-2 text-xs text-destructive">{error}</p>}
      {suggestionFailed && <Button size="sm" variant="outline" disabled={busy} onClick={() => void chooseMode("model")}>Retry</Button>}
    </div>
  );
}

export function registerDecisionsApp(app: PluginAppBuilder) {
  app.slots.settingsSection({
    id: "decisions-jev-connection",
    title: "Jev connection",
    description: "Which Jev providers Studio Decisions will call, in order, for Smart Queue and other plugins.",
    component: JevConnection,
  });
  app.slots.settingsSection({
    id: "decisions-fallback-model",
    title: "Fallback model",
    description: "The model that decides when no Jev provider answers.",
    component: FallbackModel,
  });
}
