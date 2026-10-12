// The bot's Model control (title bar and Info tab): BB's provider/model
// picker and permission picker, bound to bot_set_model. BB keeps a thread on
// one provider, so the same provider switches the bot's thread in place and
// another provider hands it off to a new thread there ("Handing off to Codex…").
import { errorMessage } from "@bb-studio/kit/format";
import { experimental_PermissionModePicker as PermissionModePicker, experimental_ProviderModelPicker as ProviderModelPicker, experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import type { BotView } from "../../contract";
import { useCall } from "../live";

type Bot = NonNullable<BotView["bot"]>;
type Reasoning = NonNullable<Bot["reasoningLevel"]>;
type Permission = NonNullable<Bot["permissionMode"]>;
export type ModelChoice = { providerId: string; model: string; reasoningLevel: Reasoning };

/** What saving a choice does: nothing, a switch in place, or a handoff to another provider. */
export function modelChangeKind(bot: Pick<Bot, "providerId" | "model" | "reasoningLevel">, next: ModelChoice): "unchanged" | "in-place" | "handoff" {
  if (bot.providerId && bot.providerId !== next.providerId) return "handoff";
  return bot.model === next.model && (bot.reasoningLevel ?? null) === next.reasoningLevel ? "unchanged" : "in-place";
}

/** The status line while a change saves. */
export function pendingLabel(kind: "in-place" | "handoff", providerName: string, model: string): string {
  return kind === "handoff" ? `Handing off to ${providerName}…` : `Switching to ${model}…`;
}

export function BotModelControl({ bot, onChanged, showPermission = false, align = "end" }: { bot: Bot; onChanged(): void; showPermission?: boolean; align?: "start" | "end" }) {
  const call = useCall();
  const { providers } = useProviders();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => providers.find((each) => each.id === id)?.displayName ?? id;
  if (!bot.providerId || !bot.model) return null;
  const value: ModelChoice = { providerId: bot.providerId, model: bot.model, reasoningLevel: bot.reasoningLevel ?? "none" };
  const save = async (next: ModelChoice, permission?: Permission) => {
    const kind = permission ? "in-place" : modelChangeKind(bot, next);
    if (kind === "unchanged" || pending) return;
    setPending(pendingLabel(kind, name(next.providerId), next.model));
    setError(null);
    try {
      await call("bot_set_model", { botId: bot.id, providerId: next.providerId, model: next.model, reasoning: next.reasoningLevel, ...(permission ? { permission } : {}) });
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  };
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-testid="bot-model">
      <ProviderModelPicker value={value} align={align} disabled={!!pending} onChange={(next) => void save({ providerId: next.providerId, model: next.model, reasoningLevel: next.reasoningLevel })} />
      {showPermission ? <PermissionModePicker providerId={bot.providerId} value={bot.permissionMode ?? "accept-edits"} disabled={!!pending} align={align} onChange={(permission) => void save(value, permission)} /> : null}
      {pending ? <span role="status" className="truncate text-xs text-muted-foreground" data-testid="bot-model-pending">{pending}</span> : null}
      {error ? <span role="alert" className="truncate text-xs text-destructive" title={error}>{error}</span> : null}
    </span>
  );
}
