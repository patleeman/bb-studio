// A bot's desk. Chat is the ongoing DM (quick asks and its reports), Tasks is
// the work you've handed it, Profile is its instructions and memory.
import { ThreadChat } from "@get-bb/plugin-sdk/app";
import { Icon, OUTLINE_BUTTON, PRIMARY_BUTTON, PageColumn, openAppPath } from "@bb-studio/kit/app";
import { useState } from "react";
import { DelegateDialog } from "./DelegateDialog";
import { Face } from "./Face";
import { externalAgentName, useExternalHealth } from "./external";
import { TaskRow } from "./OfficeHome";
import { useCall, useLive, useTeam, type BotDesk as Desk, type Space } from "./model";
import { openOffice } from "./routes";
import { cn } from "./styles";

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
                <p>You haven't talked with {bot.name} directly yet.</p>
                <button type="button" disabled={starting} onClick={() => void startDirect()} className={cn(OUTLINE_BUTTON, "mt-3")}>Message {bot.name}</button>
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
                  ? <><dt className="text-muted-foreground">Runs on</dt><dd>{agent}, an outside agent{agentHealth ? ` · ${agentHealth.online ? "online" : `offline${agentHealth.message ? `: ${agentHealth.message}` : ""}`}` : ""}</dd></>
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
                    <section><h2 className="mb-2 text-sm font-medium text-muted-foreground">Mission</h2><pre className="whitespace-pre-wrap rounded-md border border-border p-3 font-sans text-sm">{desk.data.memory.mission || "No mission yet."}</pre></section>
                    <section><h2 className="mb-2 text-sm font-medium text-muted-foreground">Memory</h2><pre className="whitespace-pre-wrap rounded-md border border-border p-3 font-sans text-sm">{desk.data.memory.memory || "Nothing remembered yet."}</pre></section>
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
