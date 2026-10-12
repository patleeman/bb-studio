// The Bot's workspace (nav panel `bot`, /plugins/studio/bot): its main
// thread (BB's ThreadChat) always fills the page, its sidebar on the left
// lists the threads it started, and the right panel's fixed tabs hold its
// Info and the sub-threads the user opened (BotTabs.tsx). Identity, status
// and the ⋯ menu sit in the panel's title bar. With no Bot yet, the page greets the user as one and
// the first message makes it. Studio's old address redirects here.
import { errorMessage } from "@bb-studio/kit/format";
import { DANGER_BUTTON, GHOST_BUTTON, ICON_BUTTON, openAppPath, OUTLINE_BUTTON, PageColumn, PRIMARY_BUTTON, StudioBar } from "@bb-studio/kit/app";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  Icon, Input, Textarea,
} from "@bb-studio/kit/ui";
import { ThreadChat } from "@get-bb/plugin-sdk/app";
import { useEffect, useState, type ReactNode } from "react";
import type { BotActivityView, BotScheduledView, BotSkillView, BotThreadView, BotView, HeartbeatRun } from "../../contract";
import { pagePath } from "../../pages/constants";
import { useCall, useLive } from "../live";
import { HeartbeatFields, useHeartbeatForm } from "../ProjectLeads";
import { BOT_COLORS, BOT_SHAPES, BOT_STYLES, BotAvatar, colorForName, DEFAULT_SHAPE } from "./BotAvatar";
import { BotSidebar } from "./BotSidebar";
import { Composer as ChatComposer, Greeting as ChatGreeting, type Starter } from "./Onboarding";
import { useOpenInfo, useOpenSubThread } from "./workspace";

/** The Bot's nav panel: its id and path under /plugins/studio. */
export const BOT_PANEL = "bot";
export const BOT_PATH = `/plugins/studio/${BOT_PANEL}`;
/** Studio's old address for the Bot (/plugins/studio/studio/bot), which redirects. */
export const BOT_SUBPATH = "bot";
type Preset = "morning" | "evening" | "working" | "off";
/** Check-in presets (bot_checkin_preset): one schedule and one line on the Memory page each. */
export const PRESETS: { id: Preset; label: string; hint: string }[] = [
  { id: "morning", label: "Morning brief", hint: "Weekdays 8:00" },
  { id: "evening", label: "Evening wrap-up", hint: "Weekdays 18:00" },
  { id: "working", label: "Every 2 hours while I'm working", hint: "Weekdays 9–17" },
  { id: "off", label: "Off", hint: "Only when you message" },
];

/** Which preset a schedule is, if any. */
export function presetOf(run: HeartbeatRun | null): Preset | null {
  if (!run?.enabled) return "off";
  if (run.cadence === "weekdays" && run.time === "08:00") return "morning";
  if (run.cadence === "weekdays" && run.time === "18:00") return "evening";
  if (run.cadence === "custom" && run.cron === "0 9-17/2 * * 1-5") return "working";
  return null;
}
const COMPLETED_PREVIEW = 3;
const threadPath = (id: string) => `/threads/${encodeURIComponent(id)}`;

const STATE_DOT = { active: "bg-success", paused: "bg-warning", stopped: "bg-muted-foreground/50" } as const;
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

/** Studio's old address (/plugins/studio/studio/bot): replaced by the Bot's own panel. */
export function BotRedirect() {
  useEffect(() => { openAppPath(BOT_PATH, { replace: true }); }, []);
  return null;
}

type Profile = { name: string; shape: string | null; color: string | null; role: string };

/** The centered top of the page: avatar (its pencil edits the profile), name and live status. */
function Identity({ avatar, profile, status, dot, onEdit, working = false, compact = false }: { avatar: string; profile: Profile; status: string; dot: string; onEdit(): void; working?: boolean; compact?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button type="button" className="group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Edit profile" onClick={onEdit}>
        <BotAvatar shape={profile.shape} color={profile.color} emoji={avatar} size={compact ? 36 : 48} working={working} />
        <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground group-hover:text-foreground" aria-hidden><Icon name="Edit" className="size-3" /></span>
      </button>
      <h1 className={`${compact ? "mt-1" : "mt-1.5"} max-w-full truncate text-sm font-semibold`}>{profile.name}</h1>
      <span className="flex max-w-full items-center gap-1.5 text-xs text-muted-foreground" data-testid="bot-status">
        <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span className="truncate">{status}</span>
      </span>
    </div>
  );
}

/**
 * No Bot yet: the page already looks like its chat. It greets the user, a
 * chip opens the profile editor, and the first message makes the Bot.
 */
function CreateBot({ onCreated }: { onCreated(): void }) {
  const [profile, setProfile] = useState<Profile>({ name: "Bot", shape: DEFAULT_SHAPE, color: BOT_COLORS[0], role: "" });
  const [editing, setEditing] = useState(false);
  const { run, busy, error } = useAction(onCreated);
  const make = async (message: string) => {
    if (busy) return false;
    const made = await run("bot_create", { name: profile.name, avatar: "🤖", shape: profile.shape ?? DEFAULT_SHAPE, color: profile.color ?? BOT_COLORS[0], ...(message.trim() ? { prompt: message.trim() } : {}) });
    if (made && profile.role.trim()) await run("bot_set", { role: profile.role.trim() });
    return !!made;
  };
  const starter = (next: Starter) => {
    if (next.kind === "customize") setEditing(true);
    else if (next.kind === "send") void make(next.text);
    else void make("Set up a morning brief for me: weekdays at 8:00.");
  };
  const identity = { name: profile.name, avatar: "🤖", shape: profile.shape, color: profile.color };
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <style>{BOT_STYLES}</style>
      <header className="shrink-0 px-24 pt-5 pb-3"><Identity avatar="🤖" profile={profile} status="New" dot="bg-muted-foreground/50" onEdit={() => setEditing(true)} /></header>
      <>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[44rem] flex-col justify-end px-4 py-6">
            <ChatGreeting bot={identity} onStarter={starter} lines={["Hey! I'm your bot.", "I see every project, check in on a schedule and tell you what needs you. Give me a name and a look, or just tell me what to keep an eye on."]} />
          </div>
        </div>
        <div className="mx-auto w-full max-w-[44rem] shrink-0 px-4 pb-4">
          {error ? <p role="alert" className="mb-2 px-1 text-xs text-destructive">{error}</p> : null}
          <ChatComposer name={profile.name} onSend={(text) => make(text)} />
        </div>
      </>
      {editing ? <ProfileDialog value={profile} onClose={() => setEditing(false)} onSave={(next) => { setProfile(next); setEditing(false); }} /> : null}
    </div>
  );
}

export type Sheet = "profile" | "skills" | "checkins" | "stop" | null;

/** The Bot's controls, shared by the page and its Info tab: RPCs, dialogs, and opening its Memory. */
export function useBotControls(view: BotView, refresh: () => void, running: number) {
  const bot = view.bot!;
  const { run, busy, error } = useAction(refresh);
  const [sheet, setSheet] = useState<Sheet>(null);
  const profile: Profile = { name: bot.name, shape: bot.shape ?? null, color: bot.color ?? null, role: bot.role ?? "" };
  const openMemory = async () => {
    const memory = bot.memoryPageId ? { pageId: bot.memoryPageId } : await run("bot_memory") as { pageId: string | null } | null;
    if (memory?.pageId) openAppPath(pagePath(memory.pageId));
  };
  const sheets = (
    <>
      {sheet === "profile" || sheet === "skills" ? (
        <ProfileDialog value={profile} advancedOpen={sheet === "skills"} advanced={<SkillsList name={bot.name} />} onClose={() => setSheet(null)}
          onSave={(next) => {
            setSheet(null);
            const input = {
              ...(next.name !== bot.name ? { name: next.name } : {}),
              ...(next.shape && next.shape !== bot.shape ? { shape: next.shape } : {}),
              ...(next.color && next.color !== bot.color ? { color: next.color } : {}),
              ...(next.role.trim() !== (bot.role ?? "") ? { role: next.role.trim() } : {}),
            };
            if (Object.keys(input).length) void run("bot_set", input);
          }} />
      ) : null}
      {sheet === "checkins" ? (
        <CheckinsDialog run={view.run} busy={!!busy} onClose={() => setSheet(null)}
          onPreset={(preset) => { setSheet(null); void run("bot_checkin_preset", { preset }); }}
          onSave={(input) => { setSheet(null); void run("bot_set_run", input); }} />
      ) : null}
      {sheet === "stop" ? (
        <Dialog open onOpenChange={(open) => !open && setSheet(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Stop {bot.name}?</DialogTitle>
              <DialogDescription>
                It pauses, its check-ins and automations turn off{running ? `, and the ${running} running thread${running === 1 ? "" : "s"} it started stop` : ""}. Its chat and data are kept; you can resume it later.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button type="button" className={GHOST_BUTTON} onClick={() => setSheet(null)}>Cancel</button>
              <button type="button" className={DANGER_BUTTON} disabled={!!busy} onClick={() => { setSheet(null); void run("bot_stop"); }}>Stop</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
  return { bot, profile, run, busy, error, setSheet, openMemory, sheets };
}

/** Threads it started that are running now. */
export const runningCount = (activity: BotActivityView | null | undefined) => activity?.inProgress.filter((thread) => thread.relation === "started").length ?? 0;
export const openThreadPage = (threadId: string) => openAppPath(threadPath(threadId));

/**
 * The Bot's workspace: its sidebar on the left, its main thread filling the
 * page, and the right panel's Info and Threads tabs (src/ui/bot/BotTabs.tsx).
 */
function BotPage({ view, refresh }: { view: BotView; refresh(): void }) {
  const activity = useLive<BotActivityView>("bot_activity", {}, { pollMs: 15_000 });
  const chain = useLive<{ threadIds: string[] }>("bot_chain", {}, { pollMs: 120_000 });
  const running = runningCount(activity.data);
  const controls = useBotControls(view, () => { refresh(); activity.refresh(); }, running);
  const { bot, profile, run, busy, error, setSheet } = controls;
  const openInfo = useOpenInfo();
  const openSub = useOpenSubThread(bot.id, openThreadPage);
  const startedNeedsYou = (activity.data?.needsYou ?? []).filter((thread) => thread.relation === "started");
  const status = statusLabel(view.run, bot.state, running);
  // Earlier conversations: the handoff chain before its current thread (bot_chain ends at it), newest first.
  const ids = chain.data?.threadIds ?? [];
  const earlier = bot.threadId && ids.at(-1) === bot.threadId ? ids.slice(0, -1).reverse() : [];

  return (
    <div className="studio-root relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <style>{BOT_STYLES}</style>
      {/* Identity and controls live in the panel's title bar, like a thread's. */}
      <StudioBar>
        <button type="button" className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring" aria-label="Edit profile" title="Edit profile" onClick={() => setSheet("profile")}>
          <BotAvatar shape={profile.shape} color={profile.color} emoji={bot.avatar} size={20} working={running > 0} />
          <span className="truncate text-sm font-medium">{profile.name}</span>
        </button>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-testid="bot-status">
          <span className={`size-1.5 shrink-0 rounded-full ${STATE_DOT[bot.state]}`} aria-hidden />
          <span className="truncate">{status}</span>
        </span>
        {startedNeedsYou.length ? (
          <button type="button" className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground" aria-label={`${startedNeedsYou.length} need${startedNeedsYou.length === 1 ? "s" : ""} you`}
            onClick={() => startedNeedsYou.length === 1 ? openSub(startedNeedsYou[0]!.id) : openInfo()}>
            <span className="size-1.5 rounded-full bg-warning" aria-hidden />
            {startedNeedsYou.length === 1 ? "Needs you" : `${startedNeedsYou.length} need you`}
          </button>
        ) : null}
        <span className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={ICON_BUTTON} aria-label="Bot menu" disabled={!!busy}><Icon name="MoreHorizontal" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onSelect={() => setSheet("profile")}><Icon name="Edit" />Edit profile…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void controls.openMemory()}><Icon name="FileText" />Memory</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSheet("skills")}><Icon name="ListTodo" />Skills…</DropdownMenuItem>
              {bot.state === "active" ? <DropdownMenuItem onSelect={() => setSheet("checkins")}><Icon name="Calendar" />Check-ins…</DropdownMenuItem> : null}
              {bot.threadId ? <DropdownMenuItem onSelect={() => openThreadPage(bot.threadId!)}><Icon name="ExternalLink" />Open as thread</DropdownMenuItem> : null}
              <DropdownMenuSeparator />
              {bot.state === "active"
                ? <DropdownMenuItem onSelect={() => void run("bot_pause")}><Icon name="Pause" />Pause</DropdownMenuItem>
                : <DropdownMenuItem onSelect={() => void run("bot_resume")}><Icon name="Play" />Resume</DropdownMenuItem>}
              {bot.state !== "stopped" ? <DropdownMenuItem variant="destructive" onSelect={() => setSheet("stop")}><Icon name="Square" />Stop…</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className={ICON_BUTTON} aria-label="Bot info" title="Info" onClick={() => openInfo()}><Icon name="Info" /></button>
        </div>
      </StudioBar>

      <div className="flex min-h-0 flex-1">
        <BotSidebar bot={bot} status={status} working={running > 0} activity={activity.data} earlier={earlier} onOpen={openSub} />
        <div className="flex min-w-0 flex-1 flex-col">
          {error ? <p role="alert" className="shrink-0 px-4 py-1.5 text-sm text-destructive">{error}</p> : null}
          {bot.state !== "active" ? (
            <div className="flex shrink-0 items-center justify-center gap-3 border-b border-border px-4 py-1.5 text-sm text-muted-foreground">
              <span className="min-w-0">{bot.name} is {bot.state}. Check-ins are off and it won't start new work.</span>
              <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => void run("bot_resume")}><Icon name="Play" />Resume</button>
            </div>
          ) : null}
          {bot.threadId ? (
            <section aria-label="Chat" className="min-h-0 flex-1">
              <ThreadChat key={bot.threadId} threadId={bot.threadId} variant="full" className="h-full" />
            </section>
          ) : (
            <p className="m-auto max-w-sm text-center text-sm text-muted-foreground">{bot.name} has no chat. Make a thread your Bot from its ⋯ menu.</p>
          )}
        </div>
      </div>
      {controls.sheets}
    </div>
  );
}

export function statusLabel(run: HeartbeatRun | null, state: keyof typeof STATE_LABEL, running = 0): string {
  if (state !== "active") return STATE_LABEL[state];
  if (running) return `Working on ${running} thread${running === 1 ? "" : "s"}`;
  if (!run?.enabled) return "Idle";
  const cadence = run.cadence === "custom" ? "on a schedule" : run.cadence.replace(/^every(\d+)(minutes|hours)$/, "every $1 $2").replace(/^every(\w)/, "every $1");
  return `Checks in ${cadence}${run.time && /daily|weekdays|weekly/.test(run.cadence) ? ` at ${run.time}` : ""}`;
}

/** Activity's sections, only those with something in them; one quiet line when all are empty. */
export function ActivityPanel({ data, loading, error, onOpen = openThreadPage }: { data: BotActivityView | null | undefined; loading: boolean; error?: string | null; onOpen?(threadId: string): void }) {
  const [allRecent, setAllRecent] = useState(false);
  if (!data) return <p className="px-4 py-3 text-xs text-muted-foreground">{loading ? "Loading…" : ""}</p>;
  const recent = allRecent ? data.completed : data.completed.slice(0, COMPLETED_PREVIEW);
  const empty = !data.needsYou.length && !data.waiting?.length && !data.inProgress.length && !data.scheduled.length && !data.completed.length;
  return (
    <div className="flex flex-col gap-4 px-2.5 pt-2 pb-3">
      {empty ? <p className="px-1.5 text-sm text-muted-foreground">Nothing going on right now.</p> : null}
      {data.needsYou.length ? <Section title="Needs you"><ThreadList threads={data.needsYou} onOpen={onOpen} /></Section> : null}
      {data.inProgress.length ? <Section title="Running"><ThreadList threads={data.inProgress} onOpen={onOpen} /></Section> : null}
      {data.waiting?.length ? <Section title="Waiting to start"><ThreadList threads={data.waiting} onOpen={onOpen} /></Section> : null}
      {data.scheduled.length ? <Section title="Scheduled"><ScheduledList items={data.scheduled} /></Section> : null}
      {data.completed.length ? (
        <Section title="Recent">
          <ThreadList threads={recent} onOpen={onOpen} />
          {data.completed.length > COMPLETED_PREVIEW ? (
            <button type="button" className="self-start px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAllRecent(!allRecent)}>
              {allRecent ? "Show fewer" : `Show all ${data.completed.length}`}
            </button>
          ) : null}
        </Section>
      ) : null}
      {error ? <p role="alert" className="px-1.5 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <h3 className="px-1.5 pb-1 text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ThreadList({ threads, onOpen }: { threads: BotThreadView[]; onOpen(threadId: string): void }) {
  return (
    <ul className="flex flex-col">
      {threads.map((thread) => (
        <li key={thread.id}>
          <button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-state-hover" onClick={() => onOpen(thread.id)}>
            <span className="min-w-0 flex-1 truncate">{thread.relation === "self" ? "Its chat" : thread.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{ago(thread.updatedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ScheduledList({ items }: { items: BotScheduledView[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item.id} className="flex min-w-0 items-center gap-2 px-1.5 py-1 text-sm">
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{!item.enabled ? "off" : item.nextRunAt ? when(item.nextRunAt) : "on"}</span>
        </li>
      ))}
    </ul>
  );
}

/** Check-ins: a preset in one click (Morning brief, Evening wrap-up, Every 2 hours, Off), or a custom schedule. */
function CheckinsDialog({ run, busy, onClose, onPreset, onSave }: { run: HeartbeatRun | null; busy: boolean; onClose(): void; onPreset(preset: Preset): void; onSave(input: unknown): void }) {
  const form = useHeartbeatForm(run);
  const current = presetOf(run);
  const [custom, setCustom] = useState(current === null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Check-ins</DialogTitle>
          <DialogDescription>When it checks in on its own. Each preset adds one line to its Memory page saying what to do.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1" role="radiogroup" aria-label="Check-in preset">
          {PRESETS.map((preset) => (
            <button key={preset.id} type="button" role="radio" aria-checked={current === preset.id} disabled={busy} onClick={() => onPreset(preset.id)}
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left text-sm hover:bg-state-hover aria-checked:border-foreground/40 aria-checked:bg-state-active">
              <span className="min-w-0 flex-1 font-medium">{preset.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{preset.hint}</span>
              {current === preset.id ? <Icon name="Check" className="size-4 shrink-0" /> : null}
            </button>
          ))}
          <button type="button" aria-expanded={custom} className="mt-2 flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setCustom(!custom)}>
            <Icon name={custom ? "ChevronDown" : "ChevronRight"} className="size-3.5" />Custom schedule
          </button>
        </div>
        {custom ? <div className="flex flex-col gap-3 text-sm"><HeartbeatFields form={form} disabled={busy} needs={null} /></div> : null}
        <DialogFooter>
          <button type="button" className={GHOST_BUTTON} onClick={onClose}>{custom ? "Cancel" : "Done"}</button>
          {custom ? <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => onSave(form.input())}>Save</button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Edit profile: the drawn avatar (shape and color), its name, and the role it's given. Advanced holds its skills. */
function ProfileDialog({ value, advanced, advancedOpen = false, onClose, onSave }: { value: Profile; advanced?: ReactNode; advancedOpen?: boolean; onClose(): void; onSave(next: Profile): void }) {
  const [draft, setDraft] = useState<Profile>({ ...value, shape: value.shape ?? DEFAULT_SHAPE, color: value.color ?? colorForName(value.name) });
  const [showAdvanced, setShowAdvanced] = useState(advancedOpen);
  const patch = (next: Partial<Profile>) => setDraft({ ...draft, ...next });
  const save = () => { if (draft.name.trim()) onSave({ ...draft, name: draft.name.trim() }); };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit profile</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex justify-center"><BotAvatar shape={draft.shape} color={draft.color} emoji="🤖" size={72} /></div>
          <div className="grid grid-cols-9 gap-1" role="radiogroup" aria-label="Shape">
            {BOT_SHAPES.map((shape) => (
              <button key={shape} type="button" role="radio" aria-checked={draft.shape === shape} aria-label={`Shape ${shape}`} onClick={() => patch({ shape })}
                className="flex aspect-square items-center justify-center rounded-md hover:bg-state-hover aria-checked:bg-state-active aria-checked:ring-1 aria-checked:ring-border">
                <BotAvatar shape={shape} color={draft.color} emoji="" size={26} />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Color">
            {BOT_COLORS.map((color) => (
              <button key={color} type="button" role="radio" aria-checked={draft.color === color} aria-label={`Color ${color}`} onClick={() => patch({ color })}
                className="size-5 rounded-full outline-offset-2 aria-checked:outline aria-checked:outline-2 aria-checked:outline-foreground" style={{ background: color }} />
            ))}
            <button type="button" className="ml-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => patch({ color: colorForName(draft.name) })}>Match the name</button>
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Name</span>
            <Input aria-label="Bot name" value={draft.name} maxLength={60} onChange={(event) => patch({ name: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Description</span>
            <Textarea aria-label="Role" rows={2} maxLength={400} placeholder="You are my chief of staff." value={draft.role} onChange={(event) => patch({ role: event.target.value })} />
          </label>
          {advanced ? (
            <div className="flex flex-col gap-2">
              <button type="button" aria-expanded={showAdvanced} className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAdvanced(!showAdvanced)}>
                <Icon name={showAdvanced ? "ChevronDown" : "ChevronRight"} className="size-3.5" />Advanced — skills
              </button>
              {showAdvanced ? advanced : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <button type="button" className={GHOST_BUTTON} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY_BUTTON} disabled={!draft.name.trim()} onClick={save}>Save</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The Bot's own skills: only its thread loads them. Share moves one into BB's user skills, for every agent. */
function SkillsList({ name }: { name: string }) {
  const skills = useLive<{ skills: BotSkillView[] }>("bot_skills", {}, { pollMs: 30_000 });
  const { run, busy, error } = useAction(skills.refresh);
  const list = skills.data?.skills ?? [];
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">Procedures {name} saved. Only it uses them until you share one with every agent.</p>
      {!list.length ? <p className="text-sm text-muted-foreground/70">{skills.loading && !skills.data ? "Loading…" : "No skills yet"}</p> : (
        <ul className="flex flex-col divide-y divide-border">
          {list.map((skill) => (
            <li key={skill.name} className="flex min-w-0 items-center gap-1 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{skill.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{skill.description}</span>
              </span>
              <button type="button" className={GHOST_BUTTON} disabled={!!busy} title="Make it a skill every agent can use" onClick={() => void run("bot_skill_share", { name: skill.name })}>Share</button>
              <button type="button" className={GHOST_BUTTON} disabled={!!busy} aria-label={`Delete ${skill.name}`} onClick={() => { if (confirm(`Delete the skill ${skill.name}?`)) void run("bot_skill_delete", { name: skill.name }); }}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
