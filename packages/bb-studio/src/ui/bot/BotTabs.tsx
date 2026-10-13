// A Bot's Info: its profile, controls (Pause/Resume, Stop, the ⋯ menu with
// Edit profile, Memory, Skills, Check-ins and Switch model), Memory, skills,
// automations (check-ins, reminders, watchers, runners) and activity. It is
// the Bot page itself (/plugins/studio/bot[/<botId>], BotPanel), which the
// ⓘ on each Bot's row in the Bots list opens. Its chat and the threads it
// lists open as BB threads.
import { GHOST_BUTTON, ICON_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON } from "@bb-studio/kit/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Icon } from "@bb-studio/kit/ui";
import { useState } from "react";
import type { BotActivityView, BotView } from "../../contract";
import { useLive } from "../live";
import { ActivityPanel, BotHome, runningCount, statusLabel, useBotControls } from "./BotHome";
import { BOT_STYLES, BotAvatar, botProvider } from "./BotAvatar";
import { SwitchModelDialog } from "./BotModel";
import { externalName, externalNote } from "../../external-providers";
import { RunnersSection } from "./Runners";
import { AutomationsSection } from "./Automations";
import { useOpenThread } from "./workspace";

const STATE_DOT = { active: "bg-success", paused: "bg-warning", stopped: "bg-muted-foreground/50" } as const;

/** The Bot page (nav panel `bot`): the selected Bot's Info, or the create flow. */
export function BotPanel() {
  return <BotHome Info={InfoPage} />;
}

function InfoPage({ view, refresh }: { view: BotView; refresh(): void }) {
  return (
    <div className="studio-root h-full min-h-0 bg-background">
      <style>{BOT_STYLES}</style>
      <div className="mx-auto h-full w-full max-w-2xl">
        <Info view={view} refresh={refresh} />
      </div>
    </div>
  );
}

function Info({ view, refresh }: { view: BotView; refresh(): void }) {
  const activity = useLive<BotActivityView>("bot_activity", { botId: view.bot!.id }, { pollMs: 15_000 });
  const running = runningCount(activity.data);
  const { bot, profile, run, busy, error, setSheet, openMemory, sheets } = useBotControls(view, () => { refresh(); activity.refresh(); }, running);
  const openSub = useOpenThread();
  const [switching, setSwitching] = useState(false);
  return (
    <div className="studio-root flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground" aria-label={`${bot.name} info`}>
      <header className="flex items-start gap-3 px-4 pt-4 pb-3">
        <BotAvatar shape={profile.shape} color={profile.color} emoji={bot.avatar} size={44} working={running > 0} provider={botProvider(bot)} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-base font-semibold">{bot.name}</h2>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="bot-info-status">
            <span className={`size-1.5 shrink-0 rounded-full ${STATE_DOT[bot.state]}`} aria-hidden />
            <span className="truncate">{statusLabel(view.run, bot.state, running)}</span>
          </span>
          {profile.role ? <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{profile.role}</p> : null}
        </div>
        <button type="button" className={ICON_BUTTON} aria-label="Edit profile" title="Edit profile" onClick={() => setSheet("profile")}><Icon name="Edit" /></button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={ICON_BUTTON} aria-label="Bot menu" disabled={!!busy}><Icon name="MoreHorizontal" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onSelect={() => setSheet("profile")}><Icon name="Edit" />Edit profile…</DropdownMenuItem>
            {bot.kind === "external"
              ? <DropdownMenuItem disabled data-testid="bot-external-note"><Icon name="Info" />{externalNote(bot.providerId)}</DropdownMenuItem>
              : <>
                <DropdownMenuItem onSelect={() => void openMemory()}><Icon name="FileText" />Memory</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet("skills")}><Icon name="ListTodo" />Skills…</DropdownMenuItem>
              </>}
            {bot.state === "active" ? <DropdownMenuItem onSelect={() => setSheet("checkins")}><Icon name="Calendar" />Check-ins…</DropdownMenuItem> : null}
            {bot.threadId && bot.providerId && bot.model ? <DropdownMenuItem onSelect={() => setSwitching(true)}><Icon name="Repeat" />Switch model…</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            {bot.state === "active"
              ? <DropdownMenuItem onSelect={() => void run("bot_pause")}><Icon name="Pause" />Pause</DropdownMenuItem>
              : <DropdownMenuItem onSelect={() => void run("bot_resume")}><Icon name="Play" />Resume</DropdownMenuItem>}
            {bot.state !== "stopped" ? <DropdownMenuItem variant="destructive" onSelect={() => setSheet("stop")}><Icon name="Square" />Stop…</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {switching && bot.threadId && bot.providerId && bot.model
        ? <SwitchModelDialog threadId={bot.threadId} providerId={bot.providerId} model={bot.model} onClose={() => setSwitching(false)} onSwitched={() => refresh()} />
        : null}

      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
        {bot.threadId
          ? <button type="button" className={PRIMARY_BUTTON} data-testid="bot-open-chat" onClick={() => openSub(bot.threadId!)}><Icon name="MessageSquare" />Open chat</button>
          : null}
        {bot.state === "active"
          ? <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => void run("bot_pause")}><Icon name="Pause" />Pause</button>
          : <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => void run("bot_resume")}><Icon name="Play" />Resume</button>}
        {bot.state !== "stopped" ? <button type="button" className={GHOST_BUTTON} disabled={!!busy} onClick={() => setSheet("stop")}><Icon name="Square" />Stop…</button> : null}
      </div>
      {error ? <p role="alert" className="px-4 pb-2 text-xs text-destructive">{error}</p> : null}
      {!bot.threadId ? <p className="px-4 pb-2 text-xs text-muted-foreground">{bot.name} has no chat.{bot.primary === false ? "" : " Make a thread your Bot from its ⋯ menu."}</p> : null}

      <dl className="mx-4 flex flex-col divide-y divide-border border-y border-border text-sm">
        {bot.kind === "external" ? <InfoRow label="Runs on" value={`${externalName(bot.providerId)}${bot.model ? ` · ${bot.model}` : ""}`} action={null} /> : <>
          <InfoRow label="Memory" value="What it keeps in mind" action={{ label: "Open", run: () => void openMemory() }} />
          <InfoRow label="Skills" value="Procedures it saved" action={{ label: "Manage", run: () => setSheet("skills") }} />
        </>}
      </dl>

      <AutomationsSection botId={bot.id} botName={bot.name} onOpen={openSub} disabled={bot.state !== "active"} external={bot.kind === "external"} />
      {bot.kind === "external"
        ? <p className="px-4 pt-3 text-xs text-muted-foreground" data-testid="bot-external-note">{externalNote(bot.providerId)} Studio's Memory page, skills and runners don't reach it; chat, threads, check-ins and pause work as usual.</p>
        : <RunnersSection botId={bot.id} botName={bot.name} onOpen={openSub} disabled={bot.state !== "active"} adoptOnly />}

      <h3 className="px-4 pt-4 text-xs font-medium text-muted-foreground">Activity</h3>
      <ActivityPanel data={activity.data} loading={activity.loading} error={activity.error} onOpen={openSub} />
      {sheets}
    </div>
  );
}

function InfoRow({ label, value, action }: { label: string; value: string; action: { label: string; run(): void } | null }) {
  return (
    <div className="flex min-h-10 items-center gap-3 py-1.5">
      <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{value}</dd>
      {action ? <button type="button" className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={action.run} aria-label={`${action.label} ${label.toLowerCase()}`}>{action.label}</button> : null}
    </div>
  );
}
