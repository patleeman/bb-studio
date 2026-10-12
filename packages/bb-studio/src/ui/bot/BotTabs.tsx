// The Bot page's right-panel fixed tabs (nav panel `bot`, app.tsx):
// Info — its profile, controls, check-ins, Memory, skills and activity;
// Threads — the sub-threads the user opened, a strip of them over BB's
// thread view. Fixed tabs are a fixed set, so Threads keeps its own strip.
import { GHOST_BUTTON, ICON_BUTTON, OUTLINE_BUTTON } from "@bb-studio/kit/app";
import { Icon } from "@bb-studio/kit/ui";
import { experimental_useFixedTabTarget, ThreadChat, ThreadTitle } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { BotActivityView, BotThreadView, BotView } from "../../contract";
import { useLive } from "../live";
import { ActivityPanel, openThreadPage, PRESETS, presetOf, runningCount, statusLabel, useBotControls } from "./BotHome";
import { BotAvatar } from "./BotAvatar";
import { stripClose, stripFocus, stripMove, stripOpen, THREADS_TAB, useOpenSubThread, useStrip } from "./workspace";

const STATE_DOT = { active: "bg-success", paused: "bg-warning", stopped: "bg-muted-foreground/50" } as const;

export function BotInfoTab() {
  const view = useLive<BotView>("bot_get", {}, { pollMs: 30_000 });
  if (!view.data?.bot) return <p className="p-4 text-sm text-muted-foreground">{view.loading ? "Loading…" : "No bot yet."}</p>;
  return <Info view={view.data} refresh={view.refresh} />;
}

function Info({ view, refresh }: { view: BotView; refresh(): void }) {
  const activity = useLive<BotActivityView>("bot_activity", {}, { pollMs: 15_000 });
  const running = runningCount(activity.data);
  const { bot, profile, run, busy, error, setSheet, openMemory, sheets } = useBotControls(view, () => { refresh(); activity.refresh(); }, running);
  const openSub = useOpenSubThread(bot.id, openThreadPage);
  const preset = presetOf(view.run);
  const checkins = preset ? PRESETS.find((each) => each.id === preset)!.label : "Custom schedule";
  return (
    <div className="studio-root flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground" aria-label={`${bot.name} info`}>
      <header className="flex items-start gap-3 px-4 pt-4 pb-3">
        <BotAvatar shape={profile.shape} color={profile.color} emoji={bot.avatar} size={44} working={running > 0} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-base font-semibold">{bot.name}</h2>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="bot-info-status">
            <span className={`size-1.5 shrink-0 rounded-full ${STATE_DOT[bot.state]}`} aria-hidden />
            <span className="truncate">{statusLabel(view.run, bot.state, running)}</span>
          </span>
          {profile.role ? <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{profile.role}</p> : null}
        </div>
        <button type="button" className={ICON_BUTTON} aria-label="Edit profile" title="Edit profile" onClick={() => setSheet("profile")}><Icon name="Edit" /></button>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
        {bot.state === "active"
          ? <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => void run("bot_pause")}><Icon name="Pause" />Pause</button>
          : <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => void run("bot_resume")}><Icon name="Play" />Resume</button>}
        {bot.state !== "stopped" ? <button type="button" className={GHOST_BUTTON} disabled={!!busy} onClick={() => setSheet("stop")}><Icon name="Square" />Stop…</button> : null}
      </div>
      {error ? <p role="alert" className="px-4 pb-2 text-xs text-destructive">{error}</p> : null}

      <dl className="mx-4 flex flex-col divide-y divide-border border-y border-border text-sm">
        <InfoRow label="Check-ins" value={bot.state === "active" ? checkins : "Off while " + bot.state} action={bot.state === "active" ? { label: "Change", run: () => setSheet("checkins") } : null} />
        <InfoRow label="Memory" value="What it keeps in mind" action={{ label: "Open", run: () => void openMemory() }} />
        <InfoRow label="Skills" value="Procedures it saved" action={{ label: "Manage", run: () => setSheet("skills") }} />
      </dl>

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

export function BotThreadsTab() {
  const view = useLive<BotView>("bot_get", {}, { pollMs: 60_000 });
  const botId = view.data?.bot?.id;
  if (!botId) return <p className="p-4 text-sm text-muted-foreground">{view.loading ? "Loading…" : "No bot yet."}</p>;
  return <Threads botId={botId} name={view.data!.bot!.name} />;
}

function Threads({ botId, name }: { botId: string; name: string }) {
  const target = experimental_useFixedTabTarget(THREADS_TAB);
  const [strip, update] = useStrip(botId);
  const activity = useLive<BotActivityView>("bot_activity", {}, { pollMs: 30_000 });
  const [dragging, setDragging] = useState<string | null>(null);
  // A target is a request to open one thread: add it to the strip, then go back to untargeted.
  useEffect(() => {
    if (!target) return;
    update((current) => stripOpen(current, target.target.threadId));
    target.clear();
  }, [target?.sequence]); // eslint-disable-line react-hooks/exhaustive-deps
  const titles = new Map<string, BotThreadView>();
  for (const thread of [...(activity.data?.needsYou ?? []), ...(activity.data?.inProgress ?? []), ...(activity.data?.waiting ?? []), ...(activity.data?.completed ?? [])]) titles.set(thread.id, thread);
  const active = strip.active;
  if (!strip.open.length) {
    return (
      <div className="studio-root flex h-full flex-col items-center justify-center gap-1 bg-background p-6 text-center text-foreground">
        <Icon name="MessageSquare" className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Open a thread {name} started from its sidebar.</p>
      </div>
    );
  }
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <div role="tablist" aria-label="Open threads" className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border px-1.5">
        {strip.open.map((id, index) => {
          const thread = titles.get(id);
          const selected = id === active;
          return (
            <div key={id} role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} draggable data-thread={id}
              onClick={() => update((current) => stripFocus(current, id))}
              onAuxClick={(event) => { if (event.button === 1) update((current) => stripClose(current, id)); }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  const next = strip.open[index + (event.key === "ArrowRight" ? 1 : -1)];
                  if (next) update((current) => stripFocus(current, next));
                }
              }}
              onDragStart={(event) => { setDragging(id); event.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(event) => { if (dragging) event.preventDefault(); }}
              onDrop={(event) => { event.preventDefault(); if (dragging) update((current) => stripMove(current, dragging, index)); setDragging(null); }}
              onDragEnd={() => setDragging(null)}
              className={`group flex h-8 max-w-48 min-w-24 shrink-0 cursor-default items-center gap-1.5 rounded-t-md border border-b-0 px-2 text-[13px] ${selected ? "border-border bg-background text-foreground" : "border-transparent text-muted-foreground hover:bg-state-hover hover:text-foreground"} ${dragging === id ? "opacity-50" : ""}`}>
              {thread?.needsYou ? <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="Needs you" /> : null}
              <span className="min-w-0 flex-1 truncate">{thread ? thread.title : <ThreadTitle threadId={id} />}</span>
              <button type="button" className="flex size-4 shrink-0 items-center justify-center rounded opacity-60 hover:bg-state-hover hover:opacity-100" aria-label={`Close ${thread?.title ?? "thread"}`}
                onClick={(event) => { event.stopPropagation(); update((current) => stripClose(current, id)); }}>
                <Icon name="X" className="size-3" />
              </button>
            </div>
          );
        })}
        <span className="min-w-2 flex-1" />
        {active ? <button type="button" className={`${ICON_BUTTON} mb-0.5`} aria-label="Open as thread" title="Open as thread" onClick={() => openThreadPage(active)}><Icon name="ExternalLink" /></button> : null}
      </div>
      {active ? (
        <section aria-label="Thread" className="min-h-0 flex-1">
          <ThreadChat key={active} threadId={active} variant="full" className="h-full" />
        </section>
      ) : null}
    </div>
  );
}
