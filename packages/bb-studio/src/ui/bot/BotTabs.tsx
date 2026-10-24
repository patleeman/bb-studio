// A Bot's Info: its inline profile, controls (Pause/Resume, Stop, the ⋯ menu
// with Memory, Skills, Check-ins and Switch model), Memory, skills,
// automations (check-ins, reminders, watchers, runners) and activity. It is
// the Bot page itself (/plugins/studio/studio/bot[/<botId>], BotPanel), and the
// "Bot info" thread panel action beside a Bot's thread (BotInfoPanel). Its
// chat and the threads it lists open as BB threads.
import { GHOST_BUTTON, ICON_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON } from "../../kit/app/index";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon } from "../../kit/ui/index";
import { useState } from "react";
import { experimental_useProviders as useProviders, useBbNavigate, type PluginThreadHeaderActionProps, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { BotView } from "../../contract";
import { useLive } from "../live";
import { ActivityPanel, BotHome, BotProfileEditor, runningCount, statusLabel, useBotControls } from "./BotHome";
import { BOT_STYLES } from "./BotAvatar";
import { SwitchModelDialog } from "./BotModel";
import { externalName, externalNote } from "../../external-providers";
import { RunnersSection } from "./Runners";
import { AutomationsSection } from "./Automations";
import { ProfileChanges } from "./ProfileChanges";
import { BotMaintenance } from "./BotMaintenance";
import { BotCacheSection } from "./BotCache";
import { BOT_INFO_ACTION, useOpenThread } from "./workspace";

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

/** The "Bot info" thread panel tab: the Info of the Bot that owns the thread. */
export function BotInfoPanel({ threadId }: PluginThreadPanelProps) {
  const owner = useLive("bot_thread_owner", { threadId }, { pollMs: 120_000 });
  const botId = owner.data?.botId ?? null;
  if (!botId) return <p className="p-4 text-sm text-muted-foreground">{owner.loading || !owner.data ? "Loading…" : "Not a Bot thread. Bot info shows on a Bot's chat and the threads it started."}</p>;
  return <BotInfo botId={botId} threadId={threadId} />;
}

/** Header action beside the cache indicator on a Bot-owned thread: a borderless chrome button, like the indicator. */
export function BotInfoHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const owner = useLive("bot_thread_owner", { threadId }, { pollMs: 120_000 });
  const navigate = useBbNavigate();
  if (!owner.data?.botId) return null;
  return (
    <button type="button" data-testid="bot-info-header" aria-label="Bot info" title="Bot info"
      onClick={() => navigate.openThreadPanel({ actionId: BOT_INFO_ACTION, title: "Bot info" })}
      className={ICON_BUTTON}>
      <Icon name="Bot" aria-hidden />
    </button>
  );
}

/** One Bot's Info by id. */
export function BotInfo({ botId, threadId }: { botId: string; threadId?: string }) {
  const view = useLive("bot_get", { botId }, { pollMs: 30_000 });
  if (!view.data?.bot) return <p className="p-4 text-sm text-muted-foreground">{view.loading ? "Loading…" : view.error ?? "No bot."}</p>;
  return <Info key={view.data.bot.id} view={view.data} refresh={view.refresh} threadId={threadId} />;
}

/** `threadId`: the thread it shows beside, if any (Open chat hides on the chat itself). */
function Info({ view, refresh, threadId }: { view: BotView; refresh(): void; threadId?: string }) {
  const activity = useLive("bot_activity", { botId: view.bot!.id }, { pollMs: 15_000 });
  const running = runningCount(activity.data);
  const { bot, profile, run, busy, error, setSheet, openMemory, saveProfile, toggleSkills, skills, sheets } = useBotControls(view, () => { refresh(); activity.refresh(); }, running);
  const openSub = useOpenThread();
  const [switching, setSwitching] = useState(false);
  const profileChanged = () => { refresh(); activity.refresh(); };
  const { providers } = useProviders();
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={ICON_BUTTON} aria-label="Bot menu" title="More" disabled={!!busy}><Icon name="MoreHorizontal" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {bot.kind === "external"
          ? <DropdownMenuItem disabled data-testid="bot-external-note"><Icon name="Info" />{externalNote(bot.providerId)}</DropdownMenuItem>
          : <>
            <DropdownMenuItem onSelect={() => void openMemory()}><Icon name="FileText" />Memory</DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleSkills}><Icon name="ListTodo" />Skills…</DropdownMenuItem>
          </>}
        {bot.state === "active" ? <DropdownMenuItem onSelect={() => setSheet("checkins")}><Icon name="Calendar" />Check-ins…</DropdownMenuItem> : null}
        {bot.threadId && bot.providerId && bot.model ? <DropdownMenuItem onSelect={() => setSwitching(true)}><Icon name="Repeat" />Switch model…</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <div className="studio-root flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground" aria-label={`${bot.name} info`}>
      <BotProfileEditor bot={bot} value={profile} status={statusLabel(view.run, bot.state, running)} statusDot={STATE_DOT[bot.state]} working={running > 0} busy={!!busy}
        onChanged={profileChanged} onSave={saveProfile} actions={menu}>
        <ProfileChanges botId={bot.id} onChanged={profileChanged} />
      </BotProfileEditor>
      {switching && bot.threadId && bot.providerId && bot.model
        ? <SwitchModelDialog threadId={bot.threadId} providerId={bot.providerId} model={bot.model} onClose={() => setSwitching(false)} onSwitched={() => refresh()} />
        : null}

      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
        {bot.threadId && bot.threadId !== threadId
          ? <button type="button" className={PRIMARY_BUTTON} data-testid="bot-open-chat" onClick={() => openSub(bot.threadId!)}><Icon name="MessageSquare" />Open chat</button>
          : null}
        {bot.state === "active"
          ? <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => void run("bot_pause")}><Icon name="Pause" />Pause</button>
          : <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => void run("bot_resume")}><Icon name="Play" />Resume</button>}
        {bot.state !== "stopped" ? <button type="button" className={GHOST_BUTTON} disabled={!!busy} onClick={() => setSheet("stop")}><Icon name="Square" className="fill-current" />Stop…</button> : null}
      </div>
      {error ? <p role="alert" className="px-4 pb-2 text-xs text-destructive">{error}</p> : null}
      {!bot.threadId ? <p className="px-4 pb-2 text-xs text-muted-foreground">{bot.name} has no chat.{bot.primary === false ? "" : " Make a thread your Bot from its ⋯ menu."}</p> : null}

      <dl className="mx-4 flex flex-col divide-y divide-border border-y border-border text-sm">
        {bot.kind === "external" ? <InfoRow label="Runs on" value={`${externalName(bot.providerId)}${bot.model ? ` · ${bot.model}` : ""}`} action={null} /> : <>
          <InfoRow label="Memory" value="What it keeps in mind" action={{ label: "Open", run: () => void openMemory() }} />
          <InfoRow label="Skills" value="Procedures it saved" action={{ label: "Manage", run: toggleSkills }} />
        </>}
      </dl>
      {skills}
      {bot.kind === "external" ? null : <BotCacheSection botId={bot.id} threadId={bot.threadId} />}

      {bot.kind === "external" ? null : <BotMaintenance botId={bot.id} />}
      <AutomationsSection botId={bot.id} botName={bot.name} onOpen={openSub} disabled={bot.state !== "active"} external={bot.kind === "external"} />
      {bot.kind === "external"
        ? <p className="px-4 pt-3 text-xs text-muted-foreground" data-testid="bot-external-note">{externalNote(bot.providerId)} Studio's Memory page, skills and runners don't reach it; chat, threads, check-ins and pause work as usual.</p>
        : <RunnersSection botId={bot.id} botName={bot.name} onOpen={openSub} disabled={bot.state !== "active"} providers={providers} fallbackProviderId={bot.providerId} />}

      <h3 className="px-4 pt-4 text-xs font-medium text-muted-foreground">Activity</h3>
      <ActivityPanel data={activity.data} loading={activity.loading} error={activity.error} onOpen={openSub} providers={providers} botId={bot.id} refresh={activity.refresh} />
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
