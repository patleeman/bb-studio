// Import bot: a bot whose thread runs on an external agent provider (Studio
// Agents: Hermes, OpenClaw, Grok, Dot). Pick a provider that's ready, its
// model, and a name and look; bot_create starts the bot's thread there.
import { GHOST_BUTTON, openAppPath, PRIMARY_BUTTON } from "@bb-studio/kit/app";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon, Input } from "@bb-studio/kit/ui";
import { errorMessage } from "@bb-studio/kit/format";
import { useEffect, useState } from "react";
import type { BotView, ExternalProvidersView } from "../../contract";
import { EXTERNAL_AGENTS_PLUGIN_ID } from "../../external-providers";
import { useCall, useLive } from "../live";
import { BOT_COLORS, BOT_SHAPES, BotAvatar, ProviderLogo } from "./BotAvatar";
import { botPath } from "./selection";

export const STUDIO_AGENTS_SETTINGS_PATH = `/settings/plugins/${EXTERNAL_AGENTS_PLUGIN_ID}`;
const STATUS_LABEL = { ready: "Ready", disabled: "Not configured", offline: "Offline", unauthenticated: "Needs a key", missing: "Not installed" } as const;

export function ImportBotDialog({ onClose }: { onClose(): void }) {
  const options = useLive<ExternalProvidersView>("bot_external_providers", {}, { pollMs: 0 });
  const call = useCall();
  const providers = options.data?.providers ?? [];
  const [providerId, setProviderId] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [name, setName] = useState("");
  const [shape, setShape] = useState<string>(BOT_SHAPES[1] ?? "circle");
  const [color, setColor] = useState<string>(BOT_COLORS[5] ?? BOT_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = providers.find((each) => each.id === providerId) ?? null;
  // The first ready provider is picked; its default model with it.
  useEffect(() => {
    if (providerId || !providers.length) return;
    const ready = providers.find((each) => each.status === "ready");
    if (ready) pick(ready.id);
  }, [providers.length]);
  function pick(id: string) {
    const next = providers.find((each) => each.id === id);
    if (!next || next.status !== "ready") return;
    setProviderId(id);
    setModel((next.models.find((each) => each.isDefault) ?? next.models[0])?.id ?? "");
    setName((current) => !current || providers.some((each) => each.displayName === current) ? next.displayName : current);
  }
  const create = async () => {
    if (!provider || !model || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await call("bot_create", { name: name.trim(), avatar: "🤖", shape, color, external: { providerId: provider.id, model } }) as BotView;
      onClose();
      if (made.bot) openAppPath(botPath(made.bot.id, made.bot.primary !== false));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const openSettings = () => { onClose(); openAppPath(STUDIO_AGENTS_SETTINGS_PATH); };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="bot-import-dialog">
        <DialogHeader>
          <DialogTitle>Import bot</DialogTitle>
          <DialogDescription>A bot that runs on an external agent. Its memory and tools live there; Studio gives it a chat, threads and check-ins.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm">
          <div role="radiogroup" aria-label="Provider" className="flex flex-col gap-1">
            {options.loading && !options.data ? <p className="text-muted-foreground">Checking providers…</p> : null}
            {options.error ? <p role="alert" className="text-destructive">{options.error}</p> : null}
            {providers.map((each) => {
              const ready = each.status === "ready";
              return (
                <div key={each.id} className="flex items-center gap-2">
                  <button type="button" role="radio" aria-checked={providerId === each.id} disabled={!ready} onClick={() => pick(each.id)} data-provider={each.id}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md border border-border px-2.5 py-2 text-left enabled:hover:bg-state-hover disabled:opacity-60 aria-checked:border-foreground/40 aria-checked:bg-state-active">
                    <ProviderLogo provider={{ id: each.id, logoUrl: each.logoUrl }} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{each.displayName}</span>
                      {!ready ? <span className="block truncate text-xs text-muted-foreground" title={each.message}>{each.message}</span> : null}
                    </span>
                    <span className={`shrink-0 text-xs ${ready ? "text-success" : "text-muted-foreground"}`}>{STATUS_LABEL[each.status]}</span>
                  </button>
                </div>
              );
            })}
            {options.data && !providers.some((each) => each.status === "ready") ? (
              <button type="button" className="flex items-center gap-1 self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={openSettings}>
                <Icon name="Settings" className="size-3.5" />{options.data.installed ? "Set up a provider in Studio Agents settings" : "Install Studio Agents in Studio Setup"}
              </button>
            ) : null}
          </div>
          {provider ? (
            <label className="flex flex-col gap-1">
              <span className="font-medium">{provider.id === "openclaw" ? "Agent" : "Model"}</span>
              <select aria-label="Model" value={model} onChange={(event) => setModel(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2">
                {provider.models.map((each) => <option key={each.id} value={each.id}>{each.displayName}</option>)}
              </select>
            </label>
          ) : null}
          <div className="flex items-center gap-3">
            <BotAvatar shape={shape} color={color} emoji="🤖" size={44} provider={provider ? { id: provider.id, logoUrl: provider.logoUrl } : null} />
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-medium">Name</span>
              <Input aria-label="Bot name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="Name" />
            </label>
          </div>
          <div className="grid grid-cols-9 gap-1" role="radiogroup" aria-label="Shape">
            {BOT_SHAPES.map((each) => (
              <button key={each} type="button" role="radio" aria-checked={shape === each} aria-label={`Shape ${each}`} onClick={() => setShape(each)}
                className="flex aspect-square items-center justify-center rounded-md hover:bg-state-hover aria-checked:bg-state-active aria-checked:ring-1 aria-checked:ring-border">
                <BotAvatar shape={each} color={color} emoji="" size={22} />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Color">
            {BOT_COLORS.map((each) => (
              <button key={each} type="button" role="radio" aria-checked={color === each} aria-label={`Color ${each}`} onClick={() => setColor(each)}
                className="size-5 rounded-full outline-offset-2 aria-checked:outline aria-checked:outline-2 aria-checked:outline-foreground" style={{ background: each }} />
            ))}
          </div>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <button type="button" className={GHOST_BUTTON} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY_BUTTON} disabled={!provider || !model || !name.trim() || busy} onClick={() => void create()}>{busy ? "Importing…" : "Import"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
