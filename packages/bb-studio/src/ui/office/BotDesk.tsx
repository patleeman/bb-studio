// A bot's desk. Chat is the ongoing DM (quick asks and its reports), Tasks is
// the work you've handed it, Profile is its instructions and memory.
import { Markdown, ThreadChat } from "@get-bb/plugin-sdk/app";
import { Icon, OUTLINE_BUTTON, PRIMARY_BUTTON, PageColumn, openAppPath } from "@bb-studio/kit/app";
import { useState } from "react";
import { DelegateDialog } from "./DelegateDialog";
import { Face } from "./Face";
import { externalAgentName, useExternalHealth } from "./external";
import { TaskRow } from "./OfficeHome";
import { useCall, useLive, useTeam, type BotDesk as Desk, type Space } from "./model";
import { openOffice } from "./routes";
import { cn } from "./styles";
import { InboxRow } from "./InboxRow";
import type { InboxEvent } from "./model";

const TABS = [
  { id: "chat", label: "Chat" },
  { id: "tasks", label: "Tasks" },
  { id: "profile", label: "Profile" },
] as const;

const TRUST: Record<Desk["bot"]["trust"], string> = {
  read_only: "Asks you before changing anything outside its own files.",
  ask: "Asks you before changing anything outside its own files.",
  act: "Acts on its own and reports what it did.",
};

export function BotDesk({ space, botId, tab }: { space: Space; botId: string; tab: "chat" | "tasks" | "profile" }) {
  const call = useCall();
  const desk = useLive<Desk>("bot_desk", { botId }, { pollMs: 30_000 });
  const { bots } = useTeam(space.id);
  const agent = externalAgentName(desk.data?.bot.providerId);
  const health = useExternalHealth([desk.data?.bot.providerId]);
  const agentHealth = desk.data?.bot.providerId ? health[desk.data.bot.providerId] : undefined;
  const [delegating, setDelegating] = useState(false);
  // This bot's recent reports and requests, so its desk isn't empty before a DM exists.
  const activity = useLive<{ events: InboxEvent[] }>("inbox_list", { spaceId: space.id }, { pollMs: 60_000 });
  const botEvents = (activity.data?.events ?? []).filter((event) => event.botId === botId).slice(0, 8);
  const [starting, setStarting] = useState(false);

  if (desk.error && !desk.data) return <PageColumn><p role="alert" className="text-sm text-destructive">{desk.error}</p></PageColumn>;
  if (!desk.data) return <PageColumn><div className="h-12 w-64 animate-pulse rounded-md bg-muted" /></PageColumn>;
  const { bot, tasks, directThreadId } = desk.data;
  const state = bot.state === "needs_you" ? { label: "Needs you", tone: "text-warning-foreground" }
    : bot.state === "working" ? { label: "Working", tone: "text-success-foreground" }
    : { label: "Idle", tone: "text-muted-foreground" };

  const startDirect = async () => {
    setStarting(true);
    try { await call("talk_dm", { botId }); desk.refresh(); } finally { setStarting(false); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="mx-auto w-full max-w-3xl shrink-0 px-10 pt-10 @max-3xl/page:px-4">
        <header className="flex items-center gap-4">
          <Face name={bot.name} avatar={bot.avatar} state={bot.state} size="lg" external={agent} offline={agentHealth?.online === false} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold">{bot.name}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {bot.role ? `${bot.role} · ` : ""}
              {agent ? `${agent} agent · ` : ""}
              {agentHealth?.online === false
                ? <span className="text-muted-foreground" title={agentHealth.message ?? undefined}>Offline</span>
                : <span className={state.tone}>{state.label}</span>}
            </p>
          </div>
          <button type="button" onClick={() => setDelegating(true)} className={PRIMARY_BUTTON}><Icon name="Sent" aria-hidden />Give a task</button>
        </header>
        <div role="tablist" aria-label={`${bot.name}'s desk`} className="mt-5 flex gap-1 border-b border-border">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => openOffice(`team/${encodeURIComponent(botId)}${entry.id === "chat" ? "" : `/${entry.id}`}`)}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === entry.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {entry.label}{entry.id === "tasks" && tasks.length ? <span className="ml-1.5 text-xs text-muted-foreground">{tasks.filter((task) => task.status !== "done").length || ""}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" className={tab === "chat" && directThreadId ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1 overflow-auto"}>
        {tab === "chat"
          ? directThreadId
            ? <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 pb-4 @max-3xl/page:px-2">
                <ThreadChat key={directThreadId} threadId={directThreadId} variant="full" layout="contained" className="min-h-0 flex-1" />
              </div>
            : <div className="mx-auto max-w-3xl px-10 py-10 text-sm text-muted-foreground @max-3xl/page:px-4">
                <div className="flex items-center gap-3">
                  <p className="flex-1">You haven't messaged {bot.name} directly yet.</p>
                  <button type="button" disabled={starting} onClick={() => void startDirect()} className={OUTLINE_BUTTON}>Message {bot.name}</button>
                </div>
                {botEvents.length
                  ? <section className="mt-8 text-foreground">
                      <h2 className="mb-1 text-sm font-medium text-muted-foreground">Recent from {bot.name}</h2>
                      <ul>{botEvents.map((event) => <InboxRow key={event.key} event={event} bot={bot} onChanged={activity.refresh} />)}</ul>
                    </section>
                  : null}
              </div>
          : null}
        {tab === "tasks"
          ? <div className="mx-auto max-w-3xl px-10 py-4 @max-3xl/page:px-4">
              {tasks.length
                ? <ul>{tasks.map((task) => <TaskRow key={task.id} task={task} bot={bot} />)}</ul>
                : <p className="py-6 text-sm text-muted-foreground">No tasks yet. Give {bot.name} a task and it will report back to your Inbox.</p>}
            </div>
          : null}
        {tab === "profile"
          ? <div className="mx-auto max-w-3xl px-10 py-6 @max-3xl/page:px-4">
              <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Role</dt><dd>{bot.role ?? "Not set"}</dd>
                <dt className="text-muted-foreground">Model</dt><dd>{bot.model ?? "Space default"}</dd>
                {agent
                  ? <><dt className="text-muted-foreground">Runs on</dt><dd>{agent}, an outside agent{agentHealth && !agentHealth.online && agentHealth.message ? <span className="block text-muted-foreground">{agentHealth.message}</span> : null}</dd></>
                  : null}
                <dt className="text-muted-foreground">Trust</dt>
                <dd>
                  {TRUST[bot.trust]}
                  {agent ? <span className="mt-1 block text-muted-foreground">Trust covers what it does through Studio. On its own machine, {agent} follows its own settings.</span> : null}
                </dd>
                <dt className="text-muted-foreground">Space</dt><dd>{space.name}</dd>
              </dl>
              {desk.data.memory
                ? <div className="mt-8 space-y-6">
                    {/* Skip the mission when it only repeats the role shown above. */}
                    {desk.data.memory.mission.trim() && desk.data.memory.mission.trim() !== (bot.role ?? "").trim()
                      ? <section><h2 className="mb-2 text-sm font-medium text-muted-foreground">Mission</h2><Markdown content={desk.data.memory.mission} className="rounded-md border border-border p-3 text-sm" /></section>
                      : null}
                    <section>
                      <h2 className="mb-2 text-sm font-medium text-muted-foreground">Memory</h2>
                      {desk.data.memory.memory.replace(/^#\s*Memory\s*$/im, "").trim()
                        ? <Markdown content={desk.data.memory.memory} className="rounded-md border border-border p-3 text-sm" />
                        : <p className="text-sm text-muted-foreground">Nothing remembered yet. {bot.name} adds notes here as it works.</p>}
                    </section>
                  </div>
                : null}
              <button type="button" onClick={() => openAppPath(desk.data!.profileHref)} className={cn(OUTLINE_BUTTON, "mt-6")}><Icon name="Edit" aria-hidden />Edit profile</button>
            </div>
          : null}
      </div>

      <DelegateDialog open={delegating} onOpenChange={setDelegating} bots={bots} initialBotId={botId} onDelegated={() => desk.refresh()} />
    </div>
  );
}
