// A Bot's default model: what its new conversations start on (+ New, and
// "Fork conversation from here" on the same provider). Set in Edit space and
// from the Bot's ··· menu (Default model), with bb's own provider and model
// picker, saved by bot_set_default_model. Changing it switches no thread:
// Main and every conversation keep the model they run on.
import { experimental_ProviderModelPicker as ProviderModelPicker, experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import type { BotView } from "../../contract";
import { GHOST_BUTTON, PRIMARY_BUTTON } from "../../kit/app/index";
import { errorMessage } from "../../kit/format";
import { toReasoningLevel, type ReasoningLevel } from "../../kit/reasoning";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../kit/ui/index";
import { useCall, useLive } from "../live";

type Bot = NonNullable<BotView["bot"]>;
export type DefaultModelChoice = { providerId: string; model: string; reasoningLevel: ReasoningLevel };

/** The picker's starting value: the Bot's default, else what its Main runs on, else nothing. */
export function startingDefault(bot: Pick<Bot, "defaultModel" | "providerId" | "model"> | null | undefined): DefaultModelChoice | null {
  const preset = bot?.defaultModel;
  if (preset) return { providerId: preset.providerId, model: preset.model, reasoningLevel: preset.reasoningLevel ?? "medium" };
  return bot?.providerId && bot.model ? { providerId: bot.providerId, model: bot.model, reasoningLevel: "medium" } : null;
}

/** Whether `next` differs from what the Bot has stored (a Bot with none: any model). */
export function defaultChanged(bot: Pick<Bot, "defaultModel"> | null | undefined, next: DefaultModelChoice | null): boolean {
  if (!next?.model) return false;
  const preset = bot?.defaultModel;
  return !preset || preset.providerId !== next.providerId || preset.model !== next.model || (preset.reasoningLevel ?? null) !== next.reasoningLevel;
}

export const saveDefault = (call: ReturnType<typeof useCall>, botId: string, value: DefaultModelChoice) =>
  call("bot_set_default_model", { botId, providerId: value.providerId, model: value.model, reasoning: value.reasoningLevel });

/** bb's provider and model picker over a default model; with none yet, it starts on bb's first provider. */
export function DefaultModelPicker({ value, onChange, disabled, align }: { value: DefaultModelChoice | null; onChange(next: DefaultModelChoice): void; disabled?: boolean; align?: "start" | "center" | "end" }) {
  const { providers } = useProviders();
  const shown = value ?? (providers[0] ? { providerId: providers[0].id, model: "", reasoningLevel: "medium" as const } : null);
  if (!shown) return null;
  return (
    <span data-testid="default-model-picker" className="flex min-w-0">
      <ProviderModelPicker value={shown} disabled={!!disabled} align={align ?? "start"}
        onChange={(next) => onChange({ providerId: next.providerId, model: next.model, reasoningLevel: toReasoningLevel(next.reasoningLevel) })} />
    </span>
  );
}

/** The ··· menu's Default model: the picker in a small dialog, saved on Save. */
export function DefaultModelDialog({ botId, onClose }: { botId: string; onClose(): void }) {
  const call = useCall();
  const view = useLive("bot_get", { botId }, { pollMs: 0 });
  const bot = view.data?.bot ?? null;
  const [picked, setPicked] = useState<DefaultModelChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = picked ?? startingDefault(bot);
  const save = async () => {
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveDefault(call, botId, value);
      view.refresh();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm" data-testid="default-model-dialog">
        <DialogHeader><DialogTitle>Default model</DialogTitle></DialogHeader>
        {view.data ? <DefaultModelPicker value={value} disabled={busy} onChange={setPicked} /> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY_BUTTON} data-testid="default-model-save" disabled={busy || !defaultChanged(bot, value)} onClick={() => void save()}>Save</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
