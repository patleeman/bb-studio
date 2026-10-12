// The Bot's home in Studio (/plugins/studio/studio/bot): who it is and its
// state, its chat, what needs the user, and its Activity (src/bot.ts). With
// no Bot yet, it offers to make one.
import { errorMessage } from "@bb-studio/kit/format";
import { Badge, DANGER_BUTTON, GHOST_BUTTON, openAppPath, OUTLINE_BUTTON, PageColumn, PRIMARY_BUTTON, SECTION_TITLE } from "@bb-studio/kit/app";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon, Input, Textarea } from "@bb-studio/kit/ui";
import { ThreadChat } from "@get-bb/plugin-sdk/app";
import { useState, type ReactNode } from "react";
import type { BotActivityView, BotScheduledView, BotSkillView, BotThreadView, BotView, HeartbeatRun } from "../../contract";
import { pagePath } from "../../pages/constants";
import { useCall, useLive } from "../live";
import { HeartbeatFields, useHeartbeatForm } from "../ProjectLeads";

export const BOT_SUBPATH = "bot";
export const BOT_PATH = `/plugins/studio/studio/${BOT_SUBPATH}`;
const AVATARS = ["🤖", "🧭", "🟣", "🦉", "🐝", "✨"];
const threadPath = (id: string) => `/threads/${encodeURIComponent(id)}`;

const STATE_TONE = { active: "success", paused: "warning", stopped: "neutral" } as const;
const STATE_LABEL = { active: "Active", paused: "Paused", stopped: "Stopped" } as const;

function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function when(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return `${today ? "Today" : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** Calls an RPC, refreshing the Bot after; errors show in the home. */
function useAction(refresh: () => void) {
  const call = useCall();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (method: string, input: unknown = {}) => {
    setBusy(method);
    setError(null);
    try {
      const result = await call(method, input);
      refresh();
      return result;
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { run, busy, error };
}

export function BotHome() {
  const view = useLive<BotView>("bot_get", {}, { pollMs: 30_000 });
  if (view.loading && !view.data) return <PageColumn><p className="text-sm text-muted-foreground">Loading…</p></PageColumn>;
  if (view.error && !view.data) return <PageColumn><p role="alert" className="text-sm text-destructive">{view.error}</p></PageColumn>;
  const bot = view.data?.bot;
  if (!bot) return <CreateBot onCreated={view.refresh} />;
  return <BotPage view={view.data!} refresh={view.refresh} />;
}

/** Onboarding: name, emoji and a first message start the Bot's chat. */
function CreateBot({ onCreated }: { onCreated(): void }) {
  const [name, setName] = useState("Bot");
  const [avatar, setAvatar] = useState(AVATARS[0]!);
  const [prompt, setPrompt] = useState("");
  const { run, busy, error } = useAction(onCreated);
  const create = () => void run("bot_create", { name: name.trim() || "Bot", avatar: avatar.trim() || AVATARS[0], ...(prompt.trim() ? { prompt: prompt.trim() } : {}) });
  return (
    <PageColumn className="max-w-xl">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-2xl" aria-hidden>{avatar}</span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Create your bot</h1>
            <p className="text-sm text-muted-foreground">An always-on agent that sees every project, checks in on a schedule and tells you what needs you.</p>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Name</span>
          <Input aria-label="Bot name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Avatar</span>
          <div className="flex items-center gap-1.5">
            {AVATARS.map((each) => (
              <button key={each} type="button" aria-pressed={each === avatar} aria-label={`Avatar ${each}`} onClick={() => setAvatar(each)}
                className="flex size-8 items-center justify-center rounded-md text-lg hover:bg-state-hover aria-pressed:bg-state-active aria-pressed:ring-1 aria-pressed:ring-border">{each}</button>
            ))}
            <Input aria-label="Custom emoji" className="w-16" value={avatar} maxLength={16} onChange={(event) => setAvatar(event.target.value)} />
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">First message <span className="font-normal text-muted-foreground">(optional)</span></span>
          <Textarea aria-label="First message" rows={3} placeholder="What should it keep an eye on?" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </label>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div><button type="button" className={PRIMARY_BUTTON} disabled={!!busy || !name.trim()} onClick={create}>{busy ? "Starting…" : "Start chat"}</button></div>
      </div>
    </PageColumn>
  );
}

function BotPage({ view, refresh }: { view: BotView; refresh(): void }) {
  const bot = view.bot!;
  const activity = useLive<BotActivityView>("bot_activity", {}, { pollMs: 15_000 });
  const refreshAll = () => { refresh(); activity.refresh(); };
  const { run, busy, error } = useAction(refreshAll);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const running = activity.data?.inProgress.filter((thread) => thread.relation === "started").length ?? 0;

  const rename = async () => {
    const name = renaming?.trim();
    setRenaming(null);
    if (name && name !== bot.name) await run("bot_set", { name });
  };

  return (
    <PageColumn className="max-w-6xl pt-8">
      <header className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-2xl" aria-hidden>{bot.avatar}</span>
        <div className="min-w-0 flex-1">
          {renaming !== null ? (
            <Input aria-label="Bot name" autoFocus className="h-8 max-w-xs text-lg font-semibold" value={renaming} maxLength={60}
              onChange={(event) => setRenaming(event.target.value)} onBlur={() => void rename()}
              onKeyDown={(event) => { if (event.key === "Enter") void rename(); if (event.key === "Escape") setRenaming(null); }} />
          ) : (
            <button type="button" title="Rename" className="truncate text-left text-xl font-semibold tracking-tight hover:underline decoration-muted-foreground/40" onClick={() => setRenaming(bot.name)}>{bot.name}</button>
          )}
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge label={STATE_LABEL[bot.state]} tone={STATE_TONE[bot.state]} />
            <span>{describeRun(view.run, bot.state)}</span>
          </div>
        </div>
        <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} title="What it remembers, and its check-in list"
          onClick={async () => { const memory = bot.memoryPageId ? { pageId: bot.memoryPageId } : await run("bot_memory") as { pageId: string | null } | null; if (memory?.pageId) openAppPath(pagePath(memory.pageId)); }}>
          <Icon name="FileText" />Memory
        </button>
        <AvatarPicker value={bot.avatar} onPick={(avatar) => void run("bot_set", { avatar })} />
        {bot.state === "active"
          ? <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => void run("bot_pause")}><Icon name="Pause" />Pause</button>
          : <button type="button" className={PRIMARY_BUTTON} disabled={!!busy} onClick={() => void run("bot_resume")}><Icon name="Play" />Resume</button>}
        {bot.state !== "stopped" ? <button type="button" className={GHOST_BUTTON} disabled={!!busy} onClick={() => setStopping(true)}><Icon name="Square" />Stop</button> : null}
      </header>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {bot.state !== "active" ? (
        <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {bot.name} is {bot.state}. Its check-ins are off and it won't start new work until you resume it.
        </p>
      ) : null}

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section aria-label="Chat" className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className={SECTION_TITLE}>Chat</h2>
            {bot.threadId ? <button type="button" className={GHOST_BUTTON} onClick={() => openAppPath(threadPath(bot.threadId!))}><Icon name="ExternalLink" />Open chat</button> : null}
          </div>
          {bot.threadId ? (
            <div className="h-[560px] min-h-0 overflow-hidden rounded-md border border-border">
              <ThreadChat threadId={bot.threadId} variant="compact" />
            </div>
          ) : <p className="text-sm text-muted-foreground">{bot.name} has no chat. Make a thread your Bot from its menu, or start over.</p>}
        </section>
        <aside className="flex min-w-0 flex-col gap-5">
          <ThreadSection title="Needs you" threads={activity.data?.needsYou} empty="Nothing needs you." loading={activity.loading} />
          <ThreadSection title="In progress" threads={activity.data?.inProgress} empty="Nothing running." loading={activity.loading} />
          {activity.data?.waiting?.length ? <ThreadSection title="Waiting to start" threads={activity.data.waiting} empty="" loading={false} /> : null}
          <ScheduledSection items={activity.data?.scheduled} run={view.run} state={bot.state} onSave={(input) => void run("bot_set_run", input)} busy={!!busy} />
          <ThreadSection title="Completed" threads={activity.data?.completed} empty="Threads it starts show here when they finish." loading={activity.loading} />
          <SkillsSection name={bot.name} />
          {activity.error ? <p role="alert" className="text-xs text-destructive">{activity.error}</p> : null}
        </aside>
      </div>

      {stopping ? (
        <Dialog open onOpenChange={(open) => !open && setStopping(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Stop {bot.name}?</DialogTitle>
              <DialogDescription>
                It pauses, its check-ins and automations turn off{running ? `, and the ${running} running thread${running === 1 ? "" : "s"} it started stop` : ""}. Its chat and data are kept; you can resume it later.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button type="button" className={GHOST_BUTTON} onClick={() => setStopping(false)}>Cancel</button>
              <button type="button" className={DANGER_BUTTON} disabled={!!busy} onClick={() => { setStopping(false); void run("bot_stop"); }}>Stop</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </PageColumn>
  );
}

function describeRun(run: HeartbeatRun | null, state: string): string {
  if (state !== "active") return "Check-ins off";
  if (!run?.enabled) return "Check-ins off";
  return `Checks in ${run.cadence === "custom" ? `on ${run.cron}` : run.cadence.replace(/^every/, "every ").replace(/(\d+)(minutes|hours)/, "$1 $2")}`;
}

function AvatarPicker({ value, onPick }: { value: string; onPick(avatar: string): void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className={GHOST_BUTTON} aria-expanded={open} onClick={() => setOpen(!open)}>Avatar</button>
      {open ? (
        <div className="absolute right-0 z-10 mt-1 flex gap-1 rounded-md border border-border bg-popover p-1 shadow-md">
          {AVATARS.map((each) => (
            <button key={each} type="button" aria-label={`Avatar ${each}`} aria-pressed={each === value} className="flex size-8 items-center justify-center rounded-md text-lg hover:bg-state-hover aria-pressed:bg-state-active"
              onClick={() => { setOpen(false); onPick(each); }}>{each}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h2 className={`${SECTION_TITLE} flex items-center gap-1.5`}>{title}{count ? <span className="text-xs font-normal text-muted-foreground">{count}</span> : null}</h2>
      {children}
    </section>
  );
}

function ThreadSection({ title, threads, empty, loading }: { title: string; threads: BotThreadView[] | undefined; empty: string; loading: boolean }) {
  return (
    <Section title={title} count={threads?.length}>
      {!threads?.length ? <p className="text-xs text-muted-foreground">{loading && !threads ? "Loading…" : empty}</p> : (
        <ul className="flex flex-col">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-state-hover" onClick={() => openAppPath(threadPath(thread.id))}>
                <Icon name={thread.needsYou ? "AlertCircle" : thread.relation === "self" ? "MessageSquare" : "Workflow"} className={`size-3.5 shrink-0 ${thread.needsYou ? "text-warning" : "text-muted-foreground"}`} />
                <span className="min-w-0 flex-1 truncate">{thread.relation === "self" ? "Its chat" : thread.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{thread.needsYou ? "waiting" : ago(thread.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ScheduledSection({ items, run, state, onSave, busy }: { items: BotScheduledView[] | undefined; run: HeartbeatRun | null; state: string; onSave(input: unknown): void; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const form = useHeartbeatForm(run);
  return (
    <Section title="Scheduled" count={items?.length}>
      {items?.length ? (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.id} className="flex min-w-0 items-center gap-2 px-1.5 py-1 text-sm">
              <Icon name={item.kind === "heartbeat" ? "Calendar" : "Clock"} className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{!item.enabled ? "off" : item.nextRunAt ? when(item.nextRunAt) : "on"}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">No check-ins or automations.</p>}
      {state === "active" ? (
        editing ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-2 text-sm">
            <HeartbeatFields form={form} disabled={busy} needs={null} />
            <div className="flex justify-end gap-1">
              <button type="button" className={GHOST_BUTTON} onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" className={OUTLINE_BUTTON} disabled={busy} onClick={() => { onSave(form.input()); setEditing(false); }}>Save</button>
            </div>
          </div>
        ) : <div><button type="button" className={GHOST_BUTTON} onClick={() => setEditing(true)}>Edit check-ins</button></div>
      ) : null}
    </Section>
  );
}

/** The Bot's own skills: only its thread loads them. Share moves one into BB's user skills, for every agent. */
function SkillsSection({ name }: { name: string }) {
  const skills = useLive<{ skills: BotSkillView[] }>("bot_skills", {}, { pollMs: 30_000 });
  const { run, busy, error } = useAction(skills.refresh);
  const list = skills.data?.skills ?? [];
  return (
    <Section title="Skills" count={list.length}>
      {!list.length ? <p className="text-xs text-muted-foreground">{skills.loading && !skills.data ? "Loading…" : `${name} saves procedures it learns here. Only it uses them until you share one.`}</p> : (
        <ul className="flex flex-col">
          {list.map((skill) => (
            <li key={skill.name} className="flex min-w-0 items-center gap-2 px-1.5 py-1 text-sm">
              <Icon name="ListTodo" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{skill.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{skill.description}</span>
              </span>
              <button type="button" className={GHOST_BUTTON} disabled={!!busy} title="Make it a skill every agent can use" onClick={() => void run("bot_skill_share", { name: skill.name })}>Share</button>
              <button type="button" className={GHOST_BUTTON} disabled={!!busy} aria-label={`Delete ${skill.name}`} onClick={() => { if (confirm(`Delete the skill ${skill.name}?`)) void run("bot_skill_delete", { name: skill.name }); }}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </Section>
  );
}

/** The Bot's card on Studio's collection home: avatar, name, state and what needs the user. */
export function BotCard() {
  const view = useLive<BotView>("bot_get", {}, { pollMs: 60_000 });
  const activity = useLive<BotActivityView>("bot_activity", {}, { pollMs: 60_000, enabled: !!view.data?.bot });
  if (!view.data) return null;
  const bot = view.data.bot;
  const needs = activity.data?.needsYou.length ?? 0;
  const busy = activity.data?.inProgress.filter((thread) => thread.relation === "started").length ?? 0;
  return (
    <button type="button" onClick={() => openAppPath(BOT_PATH)}
      className="mb-3 flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-state-hover">
      <span className="flex size-8 items-center justify-center rounded-full bg-muted text-lg" aria-hidden>{bot?.avatar ?? "🤖"}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{bot ? bot.name : "Create your bot"}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {bot ? [STATE_LABEL[bot.state], needs ? `${needs} need${needs === 1 ? "s" : ""} you` : null, busy ? `${busy} in progress` : null].filter(Boolean).join(" · ") : "An always-on agent that checks in and tells you what needs you"}
        </span>
      </span>
      {needs ? <Badge label={String(needs)} tone="warning" /> : null}
      <Icon name="ChevronRight" className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
