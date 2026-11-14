// The Bot's block at the top of BB's Info tab, on a thread a Bot owns: BB's
// own Info rows (experimental_DetailRow), so the tab reads as one panel.
// Bot (its avatar and name, with Pause or Resume and Stop as one header
// icon-button group), Status, Model (the model this conversation runs on
// now, read off the thread, by its display name; not the Bot's default,
// which is in Edit space and the sidebar's ··· menu) and Needs you (how
// many; opens its Todos). BB's rows follow it.
import { experimental_DetailRow as DetailRow } from "@get-bb/plugin-sdk/app";
import { Button, COARSE_POINTER_HEADER_ICON_BUTTON_CLASS, Icon } from "../../kit/ui/index";
import type { BotView } from "../../contract";
import { loopsPath, useLoopsEnabled } from "../../loops/ui/hooks";
import { useLive } from "../live";
import { BotPresence } from "../../presence/ui/BotPresence";
import { botProvider, ProviderLogo } from "./BotAvatar";
import { useBotControls } from "./BotHome";
import { botPath } from "./selection";

type Bot = NonNullable<BotView["bot"]>;
const CONTROL = `${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} text-subtle-foreground/75 hover:text-muted-foreground`;

/** "Active", "Paused", "Stopped", or "Paused · in bb" for a Bot a BB Studio copy imported and doesn't run (the automations table's rule). */
export function botStatusText(bot: Pick<Bot, "state" | "inBb">): string {
  if (bot.inBb) return "Paused · in bb";
  return bot.state === "active" ? "Active" : bot.state === "paused" ? "Paused" : "Stopped";
}

/** `threadId` is the thread the Info tab is on; `openPath` opens a Studio page (the Bot page, its Todos). */
export function BotInfoRows({ threadId, view, refresh, openPath }: { threadId: string; view: BotView; refresh(): void; openPath(path: string): void }) {
  const bot = view.bot!;
  const { run, busy, setSheet, sheets } = useBotControls(view, refresh, 0);
  const todosOn = useLoopsEnabled() && bot.primary !== false;
  const loops = useLive("loops.list", {}, { enabled: todosOn, pollMs: 60_000 });
  const attention = useLive("bot_attention", { botId: bot.id }, { enabled: !todosOn, pollMs: 30_000 });
  const needs = todosOn ? loops.data?.needsYouNow.length ?? null : attention.data ? attention.data.attention?.count ?? 0 : null;
  const running = useLive("thread_model", { threadId }, { pollMs: 30_000 });
  const model = running.data?.model?.modelName ?? null;
  const controls = bot.inBb ? null : (
    <span role="group" aria-label={`${bot.name} controls`} className="ml-auto flex shrink-0 items-center">
      {bot.state === "active"
        ? <Button type="button" variant="ghost" size="icon" className={CONTROL} aria-label="Pause" disabled={!!busy} onClick={() => void run("bot_pause")}><Icon name="Pause" /></Button>
        : <Button type="button" variant="ghost" size="icon" className={CONTROL} aria-label="Resume" disabled={!!busy} onClick={() => void run("bot_resume")}><Icon name="Play" /></Button>}
      {bot.state !== "stopped" ? <Button type="button" variant="ghost" size="icon" className={CONTROL} aria-label="Stop" disabled={!!busy} onClick={() => setSheet("stop")}><Icon name="Square" /></Button> : null}
    </span>
  );
  return (
    <div data-testid="bot-info-rows" className="contents">
      <DetailRow label={<span className="flex items-center gap-1.5"><BotPresence bot={bot} size={16} />{botProvider(bot) ? <span data-provider={botProvider(bot)!.id} title={`Runs on ${botProvider(bot)!.id}`} className="flex size-3.5 items-center justify-center"><ProviderLogo provider={botProvider(bot)!} className="size-full" /></span> : null}<span>Bot</span></span>}>
        <span className="flex min-w-0 items-center gap-2">
          <button type="button" data-testid="bot-info-name" className="min-w-0 truncate text-left hover:underline" onClick={() => openPath(botPath(bot.id))}>{bot.name}</button>
          {controls}
        </span>
      </DetailRow>
      <DetailRow label="Status" icon="Activity"><span data-testid="bot-info-status">{botStatusText(bot)}</span></DetailRow>
      {model ? <DetailRow label="Model" icon="Cpu"><span data-testid="bot-info-model" className="truncate">{model}</span></DetailRow> : null}
      {needs ? (
        <DetailRow label="Needs you" icon="CircleAlert">
          <button type="button" data-testid="bot-info-needs" className="hover:underline" onClick={() => openPath(todosOn ? loopsPath(bot.id) : botPath(bot.id))}>{needs}</button>
        </DetailRow>
      ) : null}
      {sheets}
    </div>
  );
}
