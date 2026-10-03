import { useModuleRpc } from "../../../app";
import { useEffect, useRef, useState } from "react";
import { experimental_ProviderModelPicker as ProviderModelPicker } from "@get-bb/plugin-sdk/app";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@bb-studio/kit/ui";
import { errorMessage } from "@bb-studio/kit/format";
import type { ModelSelection } from "@bb-studio/kit/decisions-contract";
import type { ModelPreferences, ModelPurpose, TalkRpcContract } from "../shared/contract";

const purposes: { id: ModelPurpose; label: string; description: string }[] = [
  { id: "cleanup", label: "Cleanup", description: "Tidies dictation before inserting and cleans up saved recordings." },
  { id: "title", label: "Titles", description: "Names recordings when Auto-title recordings is on." },
  { id: "summary", label: "Summaries", description: "Summarizes recordings, automatically or from their menu." },
];

export function ModelSettings() {
  const rpc = useModuleRpc<TalkRpcContract>("talk");
  const [values, setValues] = useState<ModelPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const load = () => {
    setError(null);
    void rpc.call("models.get", null).then(setValues, (cause) => setError(errorMessage(cause)));
  };
  useEffect(load, [rpc]);

  const save = async (purpose: ModelPurpose, selection: ModelSelection | null | "suggest") => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const next = selection === "suggest" ? await rpc.call("models.suggest", null) : selection;
      if (selection === "suggest" && !next) throw new Error("No available provider has a model. Set up a provider in Settings → Providers, then try again.");
      setValues(await rpc.call("models.set", { purpose, selection: next }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return <div data-talk-model-settings className="space-y-4">
    <p className="text-xs text-muted-foreground">Use Studio Decisions’ fallback model, or choose a provider and model for each job. Studio Decisions runs these requests and must be enabled. Voice transcription uses Settings → AI services.</p>
    {!values && !error && <p className="text-sm text-muted-foreground" role="status">Loading models…</p>}
    {values && <div className="divide-y divide-border rounded-lg border border-border bg-card px-4">
      {purposes.map(({ id, label, description }) => {
        const value = values[id];
        return <div key={id} className="flex flex-col gap-3 py-3 sm:flex-row sm:justify-between" data-talk-model-purpose={id}>
          <div className="min-w-0 sm:max-w-[50%]">
            <div className="text-sm font-medium">{label}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
          <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
            <Select value={value ? "model" : "decisions"} disabled={saving} onValueChange={(mode) => void save(id, mode === "model" ? "suggest" : null)}>
              <SelectTrigger className="w-52 max-w-full" aria-label={`${label} model source`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="decisions">Studio Decisions</SelectItem>
                <SelectItem value="model">A specific model</SelectItem>
              </SelectContent>
            </Select>
            {value && <ProviderModelPicker value={{ ...value, reasoningLevel: value.reasoningLevel ?? "low" }} disabled={saving} align="end" onChange={(next) => void save(id, {
              providerId: next.providerId, model: next.model, reasoningLevel: next.reasoningLevel,
              ...(next.serviceTier ? { serviceTier: next.serviceTier } : {}),
            })} />}
          </div>
        </div>;
      })}
    </div>}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>{!values && <Button variant="outline" size="sm" onClick={load}>Retry</Button>}</div>}
    {saving && <p role="status" className="text-xs text-muted-foreground">Saving…</p>}
  </div>;
}
