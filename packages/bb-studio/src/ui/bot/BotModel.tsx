// "Switch model…" (the Bot's ⋯ menu): the model is the thread's, and BB's
// composer switches it within the thread's provider. BB keeps a thread on one
// provider and doesn't let a plugin intercept its composer, so a switch to
// another provider happens here: thread_handoff_to_model hands the thread off
// to a new one there ("Handing off to Codex…"), along the bot's chain. Nothing
// is stored on the bot.
import { GHOST_BUTTON, PRIMARY_BUTTON } from "../../kit/app/index";
import { errorMessage } from "../../kit/format";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../kit/ui/index";
import { experimental_ProviderModelPicker as ProviderModelPicker, experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { useCall } from "../live";

type Reasoning = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | "ultracode";
export type ModelChoice = { providerId: string; model: string; reasoningLevel: Reasoning };

/** What switching does: nothing, a switch in place, or a handoff to another provider. */
export function modelChangeKind(current: { providerId: string | null; model: string | null }, next: ModelChoice): "unchanged" | "in-place" | "handoff" {
  if (current.providerId && current.providerId !== next.providerId) return "handoff";
  return current.model === next.model ? "unchanged" : "in-place";
}

/** The status line while a switch runs. */
export function pendingLabel(kind: "in-place" | "handoff", providerName: string, model: string): string {
  return kind === "handoff" ? `Handing off to ${providerName}…` : `Switching to ${model}…`;
}

export function SwitchModelDialog({ threadId, providerId, model, onClose, onSwitched }: { threadId: string; providerId: string; model: string; onClose(): void; onSwitched(threadId: string): void }) {
  const call = useCall();
  const { providers } = useProviders();
  const [value, setValue] = useState<ModelChoice>({ providerId, model, reasoningLevel: "medium" });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => providers.find((each) => each.id === id)?.displayName ?? id;
  const kind = modelChangeKind({ providerId, model }, value);
  const run = async () => {
    if (kind === "unchanged" || pending) return;
    setPending(pendingLabel(kind, name(value.providerId), value.model));
    setError(null);
    try {
      const result = await call("thread_handoff_to_model", { threadId, providerId: value.providerId, model: value.model, reasoning: value.reasoningLevel }) as { threadId: string };
      onSwitched(result.threadId);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="switch-model">
        <DialogHeader>
          <DialogTitle>Switch model</DialogTitle>
          <DialogDescription>Now on {name(providerId)} · {model}. Another model from {name(providerId)} switches this chat in place; another provider hands it off to a new chat there with a summary, and the old one moves to Earlier conversations.</DialogDescription>
        </DialogHeader>
        <ProviderModelPicker value={value} disabled={!!pending} onChange={(next) => setValue({ providerId: next.providerId, model: next.model, reasoningLevel: next.reasoningLevel })} />
        {pending ? <p role="status" className="text-sm text-muted-foreground" data-testid="switch-model-pending">{pending}</p> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <button type="button" className={GHOST_BUTTON} disabled={!!pending} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY_BUTTON} disabled={kind === "unchanged" || !!pending} onClick={() => void run()}>{kind === "handoff" ? `Hand off to ${name(value.providerId)}` : "Switch"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
