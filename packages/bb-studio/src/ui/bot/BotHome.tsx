// The Bot page (under the Studio panel, /plugins/studio/studio/bot[/<botId>]):
// the selected Bot's Info (BotTabs.tsx), with BB's sidebar showing the Bots
// list (BotSidebar.tsx). The bare /plugins/studio/studio/bot opens
// the window's last Bot thread, or the Bot's chat, and shows the primary's
// Info only when there's neither. A Bot's chat isn't embedded here: it opens as BB's own
// thread page, from the Bots list or Info's Open chat. With no Bot yet, the
// page is a welcome that asks what the Bot should help with; Create makes it
// and opens its chat, where it sets itself up. "New bot"
// (/plugins/studio/studio/bot/new) does the same for another Bot.
// The route picks the Bot (selection.ts).
import { errorMessage, relativeTime } from "../../kit/format";
import { Badge, BAR_BUTTON, DANGER_BUTTON, GHOST_BUTTON, OUTLINE_BUTTON, openAppPath, PageColumn, PRIMARY_BUTTON, usePathname } from "../../kit/app/index";
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon, Input, Textarea } from "../../kit/ui/index";
import { Fragment, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { BotActivityView, BotLearningView, BotScheduledView, BotThreadView, BotView, HeartbeatRun } from "../../contract";
import { pagePath } from "../../pages/constants";
import { describeCron } from "../../schedule";
import { useCall, useLive, type Method, type RpcInput } from "../live";
import { HeartbeatFields, useHeartbeatForm } from "../ProjectLeads";
import { BOT_COLORS, BOT_SHAPES, BotAvatar, botProvider, colorForName, DEFAULT_SHAPE, isBotShape } from "./BotAvatar";
import { Welcome } from "./Onboarding";
import { Elapsed, ProviderStatusMark, runningLabel, type ProviderCatalogEntry } from "./ProviderStatusMark";
import { useOpenThread } from "./workspace";
import { botLanding, readLastBotThread, threadRoute } from "./threadListSwitch";
import { BOT_PATH, botPath, forBot, rememberBot, useBotSelection } from "./selection";

export { BOT_PATH };
/** The Bot page's path under the Studio panel. */
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

/** Calls an RPC, refreshing the Bot after; errors show in the home. bot_* calls act on `botId` when given. */
export function useAction(refresh: () => void, botId?: string) {
  const call = useCall();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async <M extends Extract<Method, `bot_${string}`>,>(method: M, input: RpcInput<M> = {} as RpcInput<M>) => {
    setBusy(method);
    setError(null);
    try {
      const result = await call(method, method.startsWith("bot_") && method !== "bot_create" ? forBot(botId, input) : input);
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

/** The Bot page: the selected Bot's `Info` (BotTabs.tsx passes it, so the two don't import each other), or the create flow. */
export function BotHome({ Info }: { Info: ComponentType<{ view: BotView; refresh(): void }> }) {
  const { botId, creating } = useBotSelection();
  const pathname = usePathname();
  const view = useLive("bot_get", forBot(creating ? undefined : botId), { pollMs: 30_000 });
  const landing = useBotLanding(isBareBotPath(pathname), view.data ?? undefined);
  if (view.loading && !view.data) return <PageColumn><p className="text-sm text-muted-foreground">Loading…</p></PageColumn>;
  if (view.error && !view.data) return <PageColumn><p role="alert" className="text-sm text-destructive">{view.error}</p></PageColumn>;
  if (landing) return <PageColumn><p className="text-sm text-muted-foreground">Loading…</p></PageColumn>;
  const bot = view.data?.bot;
  if (!bot || creating) return <CreateBot key={creating ? "new" : "first"} first={!bot} onCreated={view.refresh} />;
  return <Info key={bot.id} view={view.data!} refresh={view.refresh} />;
}

/** The bare Bot page, where the rail's Bot item goes (not a Bot's Info by id, nor New bot). */
export const isBareBotPath = (pathname: string) => pathname.replace(/\/+$/, "") === BOT_PATH;

/**
 * The rail's Bot item opens the window's last Bot thread (threadListSwitch.ts):
 * on the bare Bot page it goes to that thread while it exists, else the Bot's
 * chat, keeping the Bots list. The page's history entry becomes the thread's
 * first, so Back doesn't return here and redirect again. True while it
 * decides; false once the page itself should show (no Bot, or no thread).
 */
function useBotLanding(bare: boolean, view: BotView | undefined): boolean {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [settled, setSettled] = useState(false);
  const chatId = view?.bot?.threadId ?? null;
  const ready = bare && !!view;
  useEffect(() => { if (!bare) setSettled(false); }, [bare]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const locate = async (threadId: string) => {
      try {
        const thread = await sdk.threads.get({ threadId }) as { id: string; projectId: string; deletedAt?: number | null };
        return thread && !thread.deletedAt ? threadRoute(thread.id, thread.projectId) : null;
      } catch { return null; }
    };
    void botLanding(readLastBotThread(), chatId, locate).then((target) => {
      if (cancelled) return;
      if (!target) { setSettled(true); return; }
      window.history.replaceState(window.history.state, "", target.path);
      navigate.toThread(target.threadId);
    });
    return () => { cancelled = true; };
  }, [ready, chatId, sdk, navigate]);
  return bare && !settled;
}

/** shape null: the emoji avatar. */
export type Profile = { name: string; shape: Exclude<RpcInput<"bot_set">["shape"], undefined>; color: string | null; role: string; emoji: string };

/** The first Bot's name until it picks its own; a further Bot's. */
export const FIRST_BOT_NAME = "Chief of Staff";
export const NEXT_BOT_NAME = "New bot";

/**
 * No Bot yet, or New bot: the welcome (Onboarding.tsx). Create makes the Bot
 * with a default name and drawn avatar, its first message the setup (it asks
 * a couple of questions, then names and draws itself), and opens its chat.
 */
function CreateBot({ first, onCreated }: { first: boolean; onCreated(): void }) {
  const look = first
    ? { shape: DEFAULT_SHAPE, color: BOT_COLORS[0] as string, emoji: "🤖" }
    : { shape: (BOT_SHAPES[3] ?? DEFAULT_SHAPE), color: (BOT_COLORS[2] ?? BOT_COLORS[0]) as string, emoji: "🤖" };
  const { run, busy, error } = useAction(onCreated);
  const openThread = useOpenThread();
  const make = async (goal: string) => {
    if (busy) return false;
    const made = await run("bot_create", { name: first ? FIRST_BOT_NAME : NEXT_BOT_NAME, avatar: look.emoji, shape: look.shape, color: look.color, setup: goal }) as BotView | null;
    // Its chat opens as BB's thread page; with no chat yet, the page moves to the new Bot's Info.
    if (made?.bot) {
      rememberBot(made.bot.id);
      if (made.bot.threadId) openThread(made.bot.threadId);
      else openAppPath(botPath(made.bot.id), { replace: true });
    }
    return !!made;
  };
  return <Welcome first={first} look={look} busy={!!busy} error={error} onCreate={make} />;
}

export type Sheet = "checkins" | "stop" | null;

/** The Bot's controls, shared by the page and its Info tab: RPCs, dialogs, and opening its Memory. */
export function useBotControls(view: BotView, refresh: () => void, running: number) {
  const bot = view.bot!;
  const { run, busy, error } = useAction(refresh, bot.id);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const profile: Profile = { name: bot.name, shape: isBotShape(bot.shape) ? bot.shape : null, color: bot.color ?? null, role: bot.role ?? "", emoji: bot.avatar };
  const saveProfile = (next: Profile) => {
    const input = {
      ...(next.name !== bot.name ? { name: next.name } : {}),
      ...(next.shape !== (bot.shape ?? null) ? { shape: next.shape } : {}),
      ...(next.emoji.trim() && next.emoji.trim() !== bot.avatar ? { avatar: next.emoji.trim() } : {}),
      ...(next.color && next.color !== bot.color ? { color: next.color } : {}),
      ...(next.role.trim() !== (bot.role ?? "") ? { role: next.role.trim() } : {}),
    };
    if (Object.keys(input).length) void run("bot_set", input);
  };
  const toggleSkills = () => setSkillsOpen((open) => !open);
  const openMemory = async () => {
    const memory = bot.memoryPageId ? { pageId: bot.memoryPageId } : await run("bot_memory") as { pageId: string | null } | null;
    if (memory?.pageId) openAppPath(pagePath(memory.pageId));
  };
  const skills = skillsOpen && bot.kind !== "external" ? (
    <section aria-label="Skills" className="mx-4 mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">Skills</h3>
      <SkillsList botId={bot.id} name={bot.name} />
    </section>
  ) : null;
  const sheets = (
    <>
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
                It pauses, its check-ins and automations turn off{running ? ", and the threads it started stop (not your own forks of its chat)" : ""}. Its chat and data are kept; resuming turns its check-ins and automations back on.
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
  return { bot, profile, run, busy, error, setSheet, openMemory, saveProfile, toggleSkills, skills, sheets };
}

/** Threads it started that are running now. */
export const runningCount = (activity: BotActivityView | null | undefined) => activity?.inProgress.filter((thread) => thread.relation === "started").length ?? 0;
export const openThreadPage = (threadId: string) => openAppPath(threadPath(threadId));

export function statusLabel(run: HeartbeatRun | null, state: keyof typeof STATE_LABEL, running = 0): string {
  if (state !== "active") return STATE_LABEL[state];
  if (running) return `Working on ${running} thread${running === 1 ? "" : "s"}`;
  if (!run?.enabled) return "Idle";
  const cadence = run.cadence === "custom" ? "on a schedule" : run.cadence.replace(/^every(\d+)(minutes|hours)$/, "every $1 $2").replace(/^every(\w)/, "every $1");
  return `Checks in ${cadence}${run.time && /daily|weekdays|weekly/.test(run.cadence) ? ` at ${run.time}` : ""}`;
}

/** Activity's sections, only those with something in them; one quiet line when all are empty. */
export function ActivityPanel({ data, loading, error, onOpen = openThreadPage, providers }: { data: BotActivityView | null | undefined; loading: boolean; error?: string | null; onOpen?(threadId: string): void; providers?: readonly ProviderCatalogEntry[] }) {
  const [allRecent, setAllRecent] = useState(false);
  if (!data) return <p className="px-4 py-3 text-xs text-muted-foreground">{loading ? "Loading…" : ""}</p>;
  const recent = allRecent ? data.completed : data.completed.slice(0, COMPLETED_PREVIEW);
  const empty = !data.needsYou.length && !data.waiting?.length && !data.inProgress.length && !data.scheduled.length && !data.completed.length;
  return (
    <div className="flex flex-col gap-4 px-2.5 pt-2 pb-3">
      {data.maintenance?.map((run) => <div key={run.at} className="px-1.5 text-xs"><span className="font-medium">Maintenance</span> · {run.summary}</div>)}
      {empty ? <p className="px-1.5 text-sm text-muted-foreground">Nothing going on right now.</p> : null}
      {data.needsYou.length ? <Section title="Needs you"><ThreadList threads={data.needsYou} onOpen={onOpen} /></Section> : null}
      {data.inProgress.length ? <Section title="Running"><ThreadList threads={data.inProgress} onOpen={onOpen} running={providers ?? []} /></Section> : null}
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

/** `running`: the provider catalog, when these threads are running: each gets the running mark and its ticking time, as in the sidebar. */
function ThreadList({ threads, onOpen, running }: { threads: BotThreadView[]; onOpen(threadId: string): void; running?: readonly ProviderCatalogEntry[] }) {
  return (
    <ul className="flex flex-col">
      {threads.map((thread) => (
        <li key={thread.id}>
          <button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-state-hover" onClick={() => onOpen(thread.id)}>
            {running ? <ProviderStatusMark providerId={thread.providerId} tone="running" providers={running} label={runningLabel(thread.runningSince)} /> : null}
            <span className="min-w-0 flex-1 truncate">{thread.relation === "self" ? "Its chat" : thread.title}</span>
            {running && thread.runningSince != null
              ? <Elapsed since={thread.runningSince} className="text-xs text-success" />
              : <span className="shrink-0 text-xs text-muted-foreground">{ago(thread.updatedAt)}</span>}
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
          <span className="shrink-0 text-xs text-muted-foreground" title={item.cron ? describeCron(item.cron) : undefined}>{!item.enabled ? "off" : item.nextRunAt ? when(item.nextRunAt) : item.cron ? describeCron(item.cron) : "on"}</span>
        </li>
      ))}
    </ul>
  );
}

/** Check-ins: a preset in one click (Morning brief, Evening wrap-up, Every 2 hours, Off), or a custom schedule. */
function CheckinsDialog({ run, busy, onClose, onPreset, onSave }: { run: HeartbeatRun | null; busy: boolean; onClose(): void; onPreset(preset: Preset): void; onSave(input: RpcInput<"bot_set_run">): void }) {
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

/**
 * The head of Bot info: avatar, name, status and description, with Edit and
 * `actions` (the ⋯ menu) on the name's row. Edit, the name or the avatar
 * opens the inline editor; avatar image choices apply at once, the fields
 * save together. `children` (Profile changes) sit under the description.
 */
export function BotProfileEditor({ bot, value, status, statusDot, working, busy, onChanged, onSave, actions, children }: {
  bot: NonNullable<BotView["bot"]>;
  value: Profile;
  status: string;
  statusDot: string;
  working: boolean;
  busy: boolean;
  onChanged(): void;
  onSave(next: Profile): void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<Profile>({ ...value, color: value.color ?? colorForName(value.name) });
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    setDraft({ ...value, color: value.color ?? colorForName(value.name) });
  }, [bot.id, value.name, value.shape, value.color, value.role, value.emoji]);
  useEffect(() => {
    if (editing) {
      wasEditing.current = true;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        setDraft({ ...value, color: value.color ?? colorForName(value.name) });
        setEditing(false);
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
    if (wasEditing.current) {
      wasEditing.current = false;
      editButton.current?.focus();
    }
  }, [editing, bot.id, value.name, value.shape, value.color, value.role, value.emoji]);
  const patch = (next: Partial<Profile>) => setDraft((current) => ({ ...current, ...next }));
  const freshDraft = () => ({ ...value, color: value.color ?? colorForName(value.name) });
  const openEditor = () => { setDraft(freshDraft()); setEditing(true); };
  const cancel = () => { setDraft(freshDraft()); setEditing(false); };
  const initialColor = value.color ?? colorForName(value.name);
  const changed = draft.name.trim() !== value.name || draft.shape !== value.shape || draft.color !== initialColor || draft.role !== value.role || draft.emoji.trim() !== value.emoji;
  const save = () => {
    if (!draft.name.trim() || !changed) return;
    onSave({ ...draft, name: draft.name.trim(), emoji: draft.emoji.trim() || value.emoji });
    setEditing(false);
  };
  return (
    <section aria-label="Profile" className="mx-4 flex flex-col gap-3 pt-5 pb-4" data-testid="bot-profile-section">
      {editing ? (
        <div id="bot-profile-editor" className="flex flex-col gap-2.5">
          <header className="flex items-start gap-3">
            <BotAvatar shape={draft.shape} color={draft.color} emoji={draft.emoji || "🤖"} image={bot.avatarImageUrl} size={44} working={working} provider={botProvider(bot)} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium">Name</span>
                <Input autoFocus aria-label="Bot name" value={draft.name} maxLength={60} onChange={(event) => patch({ name: event.target.value })} />
              </label>
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-testid="bot-info-status">
                <span className={`size-1.5 shrink-0 rounded-full ${statusDot}`} aria-hidden />
                <span className="truncate">{status}</span>
              </span>
            </div>
          </header>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium">Avatar</span>
            <AvatarImages botId={bot.id} onChanged={onChanged} />
          </div>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Shape">
            {BOT_SHAPES.map((shape) => (
              <button key={shape} type="button" role="radio" aria-checked={draft.shape === shape} aria-label={`Shape ${shape}`} onClick={() => patch({ shape })}
                className="flex size-8 items-center justify-center rounded-md hover:bg-state-hover aria-checked:bg-state-active aria-checked:ring-1 aria-checked:ring-border">
                <BotAvatar shape={shape} color={draft.color} emoji="" size={24} />
              </button>
            ))}
            <button type="button" role="radio" aria-checked={draft.shape === null} aria-label="Emoji" title="Emoji" onClick={() => patch({ shape: null })}
              className="flex size-8 items-center justify-center rounded-md hover:bg-state-hover aria-checked:bg-state-active aria-checked:ring-1 aria-checked:ring-border">
              <BotAvatar shape={null} emoji={draft.emoji || "🤖"} size={24} />
            </button>
          </div>
          {draft.shape === null ? (
            <label className="flex items-center gap-2 text-xs">
              <span className="font-medium">Emoji</span>
              <Input aria-label="Avatar emoji" className="w-20 text-center" value={draft.emoji} maxLength={16} onChange={(event) => patch({ emoji: event.target.value })} />
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Color">
            {BOT_COLORS.map((color) => (
              <button key={color} type="button" role="radio" aria-checked={draft.color === color} aria-label={`Color ${color}`} onClick={() => patch({ color })}
                className="size-5 rounded-full outline-offset-2 aria-checked:outline aria-checked:outline-2 aria-checked:outline-foreground" style={{ background: color }} />
            ))}
            <button type="button" className="ml-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => patch({ color: colorForName(draft.name) })}>Match the name</button>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium">Description</span>
            <Textarea aria-label="Description" rows={2} maxLength={400} placeholder="You are my chief of staff." value={draft.role} onChange={(event) => patch({ role: event.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={GHOST_BUTTON} onClick={cancel}>Cancel</button>
            <button type="button" className={PRIMARY_BUTTON} disabled={busy || !draft.name.trim() || !changed} onClick={save}>Save profile</button>
          </div>
        </div>
      ) : (
        <>
          <header className="flex items-center gap-3">
            <button type="button" aria-label={`Edit ${bot.name} avatar and profile`} aria-expanded={false} onClick={openEditor}
              className="shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
              <BotAvatar shape={value.shape} color={value.color ?? colorForName(value.name)} emoji={value.emoji || "🤖"} image={bot.avatarImageUrl} size={44} working={working} provider={botProvider(bot)} />
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h2 className="min-w-0">
                <button type="button" aria-label={`Edit ${bot.name} profile`} aria-expanded={false} onClick={openEditor}
                  className="block max-w-full truncate rounded-sm text-left text-base leading-tight font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
                  {bot.name}
                </button>
              </h2>
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-testid="bot-info-status">
                <span className={`size-1.5 shrink-0 rounded-full ${statusDot}`} aria-hidden />
                <span className="truncate">{status}</span>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 self-start">
              <button ref={editButton} type="button" aria-label="Edit profile" title="Edit profile" aria-expanded={false} onClick={openEditor} className={BAR_BUTTON}>
                <Icon name="Edit" aria-hidden />Edit
              </button>
              {actions}
            </div>
          </header>
          <p className={`whitespace-pre-wrap break-words text-sm ${value.role.trim() ? "text-foreground/90" : "text-muted-foreground"}`}>
            {value.role.trim() ? value.role : "No description."}
          </p>
        </>
      )}
      {children}
    </section>
  );
}

/** The largest image Upload sends (Studio keeps at most 4 MB). */
const UPLOAD_MAX = 4 * 1024 * 1024;

/** Its image avatars: the drawn one, the last few images (made by it or uploaded), Upload, and Revert to the one before. */
function AvatarImages({ botId, onChanged }: { botId: string; onChanged(): void }) {
  const history = useLive("bot_avatar_history", { botId }, { pollMs: 60_000 });
  const { run, busy, error } = useAction(() => { history.refresh(); onChanged(); }, botId);
  const [tooBig, setTooBig] = useState(false);
  const data = history.data;
  const tile = "flex size-10 items-center justify-center overflow-hidden rounded-full ring-offset-2 ring-offset-background hover:opacity-90 aria-checked:ring-2 aria-checked:ring-foreground";
  const upload = (file: File | undefined) => {
    setTooBig(false);
    if (!file) return;
    if (file.size > UPLOAD_MAX) { setTooBig(true); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") void run("bot_avatar_upload", { data: reader.result }); };
    reader.readAsDataURL(file);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Avatar image">
        <button type="button" role="radio" aria-checked={!data?.current} disabled={!!busy} className={`${tile} bg-foreground/[0.06] text-[10px] text-muted-foreground`} onClick={() => void run("bot_avatar_use", { imageId: null })} title="The drawn avatar below">Drawn</button>
        {(data?.images ?? []).map((image) => (
          <button key={image.id} type="button" role="radio" aria-checked={data?.current === image.id} disabled={!!busy} className={tile} data-testid="bot-avatar-image"
            title={image.source === "generated" ? `It made this${image.prompt ? `: ${image.prompt}` : ""}` : "Uploaded"} onClick={() => void run("bot_avatar_use", { imageId: image.id })}>
            <img src={image.url} alt={image.prompt ?? "Uploaded avatar"} className="size-full object-cover" />
          </button>
        ))}
        <label className={`${OUTLINE_BUTTON} cursor-pointer`}>
          <Icon name="Plus" />Upload…
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" disabled={!!busy} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {data?.previous != null ? <button type="button" className={GHOST_BUTTON} disabled={!!busy} onClick={() => void run("bot_avatar_revert")} data-testid="bot-avatar-revert"><Icon name="RotateCcw" />Revert</button> : null}
      </div>
      {tooBig ? <p role="alert" className="text-xs text-destructive">That image is over 4 MB.</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** The Bot's own skills: only its thread loads them. Share moves one into BB's user skills, for every agent. */
function SkillsList({ botId, name }: { botId: string; name: string }) {
  const skills = useLive("bot_skills", { botId }, { pollMs: 30_000 });
  const learning = useLive("bot_learning", { botId }, { pollMs: 30_000 });
  const refresh = () => { skills.refresh(); learning.refresh(); };
  const { run, busy, error } = useAction(refresh, botId);
  const [showArchived, setShowArchived] = useState(false);
  const all = skills.data?.skills ?? [];
  const list = all.filter((skill) => skill.state !== "archived");
  const archived = all.filter((skill) => skill.state === "archived");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Procedures {name} saved. Only it uses them until you share one with every agent.</p>
      {learning.data ? <LearnSettings value={learning.data} busy={!!busy} run={run} /> : null}
      {!list.length ? <p className="text-sm text-muted-foreground/70">{skills.loading && !skills.data ? "Loading…" : "No skills yet"}</p> : (
        <ul className="flex flex-col divide-y divide-border">
          {list.map((skill) => (
            <li key={skill.name} className="flex min-w-0 items-center gap-1 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{skill.name}{skill.state === "stale" ? <span className="ml-1.5 text-xs font-normal text-muted-foreground" title="Not used for 30 days; archived after 90">stale</span> : null}</span>
                <span className="block truncate text-xs text-muted-foreground">{skill.description}</span>
              </span>
              <button type="button" className={GHOST_BUTTON} disabled={!!busy} aria-pressed={!!skill.pinned} aria-label={`${skill.pinned ? "Unpin" : "Pin"} ${skill.name}`} title={skill.pinned ? "Pinned: the curator leaves it alone" : "Pin: the curator leaves it alone"} onClick={() => void run("bot_skill_pin", { name: skill.name, pinned: !skill.pinned })}>
                <Icon name={skill.pinned ? "PinOff" : "Pin"} className="size-3.5" />
              </button>
              <button type="button" className={GHOST_BUTTON} disabled={!!busy} title="Make it a skill every agent can use" onClick={() => void run("bot_skill_share", { name: skill.name })}>Share</button>
              <button type="button" className={GHOST_BUTTON} disabled={!!busy} aria-label={`Delete ${skill.name}`} onClick={() => { if (confirm(`Delete the skill ${skill.name}?`)) void run("bot_skill_delete", { name: skill.name }); }}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {archived.length ? (
        <div className="flex flex-col gap-1">
          <button type="button" aria-expanded={showArchived} className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowArchived(!showArchived)}>
            <Icon name={showArchived ? "ChevronDown" : "ChevronRight"} className="size-3.5" />Archived ({archived.length})
          </button>
          {showArchived ? (
            <ul className="flex flex-col divide-y divide-border">
              {archived.map((skill) => (
                <li key={skill.name} className="flex min-w-0 items-center gap-1 py-1.5 text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">{skill.name}</span>
                  <button type="button" className={GHOST_BUTTON} disabled={!!busy} onClick={() => void run("bot_skill_restore", { name: skill.name })}>Restore</button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <SkillHistory botId={botId} onRevert={refresh} />
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * Skill history, collapsed: every saved version newest first (deleted skills
 * too, so a mistaken delete can be undone), each opening to its diff, its
 * review warnings (advice only) and Revert.
 */
function SkillHistory({ botId, onRevert }: { botId: string; onRevert(): void }) {
  const [cursors, setCursors] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const history = useLive("bot_skill_history", { botId, ...(cursors.length ? { before: cursors[cursors.length - 1] } : {}) }, { pollMs: 30_000 });
  const { run, busy, error } = useAction(() => { history.refresh(); onRevert(); }, botId);
  const versions = history.data?.versions ?? [];
  return (
    <div className="flex flex-col" aria-label="Skill history">
      <button type="button" aria-expanded={open} aria-controls="bot-skill-history" onClick={() => setOpen(!open)}
        className="-ml-1 flex h-7 items-center gap-1 self-start rounded-md pr-1.5 pl-0.5 text-xs text-muted-foreground hover:text-foreground">
        <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3.5" aria-hidden />Skill history
      </button>
      <div id="bot-skill-history" hidden={!open} className="flex flex-col gap-1.5 pt-1">
        <p className="text-xs text-muted-foreground">Saves apply right away. Revert brings back a version and keeps the current one here. Review warnings are advice; they don't block a save.</p>
        {versions.length ? (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {versions.map((version) => {
              const expanded = shown === version.id;
              return (
                <li key={version.id} data-skill-version={version.id} className="flex flex-col">
                  <button type="button" aria-expanded={expanded} onClick={() => setShown(expanded ? null : version.id)} className="flex min-h-9 min-w-0 items-center gap-2 py-1 text-left text-sm">
                    <Icon name={expanded ? "ChevronDown" : "ChevronRight"} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 truncate font-medium">{version.name}</span>
                    {version.body === null ? <Badge label="Deleted" /> : null}
                    {version.warnings.length ? <Badge label={version.warnings.length === 1 ? "1 warning" : `${version.warnings.length} warnings`} tone="warning" /> : null}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relativeTime(version.at)}</span>
                  </button>
                  <div hidden={!expanded} className="flex flex-col gap-2 pb-2.5 pl-5.5">
                    <pre className="max-h-48 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                      {version.diff.split("\n").map((line, index) => <Fragment key={index}>{index ? "\n" : ""}<span className={line.startsWith("+") ? "text-success" : line.startsWith("-") ? "text-destructive" : "text-muted-foreground"}>{line}</span></Fragment>)}
                    </pre>
                    {version.warnings.length ? (
                      <ul className="flex flex-col gap-1 text-xs">
                        {version.warnings.map((warning, index) => <li key={index} className="flex items-start gap-1.5"><Icon name="AlertTriangle" className="mt-px size-3.5 shrink-0 text-warning" aria-hidden /><span>{warning}</span></li>)}
                      </ul>
                    ) : null}
                    <button type="button" className={`${OUTLINE_BUTTON} self-start`} disabled={!!busy} aria-label={`Revert ${version.name} to version ${version.id}`} onClick={() => void run("bot_skill_revert", { versionId: version.id })}><Icon name="RotateCcw" />Revert</button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-xs text-muted-foreground">{history.loading && !history.data ? "Loading…" : history.error ?? "No saved versions yet."}</p>}
        {cursors.length || versions.length === 50 ? (
          <div className="flex gap-1">
            {cursors.length ? <button type="button" className={GHOST_BUTTON} onClick={() => setCursors(cursors.slice(0, -1))}>Newer versions</button> : null}
            {versions.length === 50 ? <button type="button" className={GHOST_BUTTON} onClick={() => setCursors([...cursors, versions[49]!.id])}>Older versions</button> : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

const LEARN_INTERVALS = [5, 10, 20, 30, 50];

/** Learn from work: the background review's switch, interval and model and the last result. */
function LearnSettings({ value, busy, run }: { value: BotLearningView; busy: boolean; run<M extends Extract<Method, `bot_${string}`>>(method: M, input?: RpcInput<M>): Promise<unknown> }) {
  const intervals = LEARN_INTERVALS.includes(value.interval) ? LEARN_INTERVALS : [...LEARN_INTERVALS, value.interval].sort((a, b) => a - b);
  const status = value.reviewing ? "Reviewing now…" : value.lastReview ? `${value.lastReview.result} · ${relativeTime(value.lastReview.at)}` : "No review yet";
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-muted/40 p-2 text-xs" aria-label="Learn from work">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.enabled} disabled={busy} aria-label="Learn from work" onChange={(event) => void run("bot_learning_set", { enabled: event.target.checked })} />
        <span className="font-medium text-foreground">Learn from work</span>
        {value.enabled ? (
          <span className="flex items-center gap-1 text-muted-foreground">every
            <select aria-label="Turns between reviews" className="rounded border border-border bg-transparent px-1" value={value.interval} disabled={busy} onChange={(event) => void run("bot_learning_set", { interval: Number(event.target.value) })}>
              {intervals.map((each) => <option key={each} value={each}>{each}</option>)}
            </select>turns</span>
        ) : null}
      </label>
      {value.enabled ? (
        <>
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="min-w-0 flex-1 truncate" aria-label="Last review">{status}</span>
            <button type="button" className={GHOST_BUTTON} disabled={busy || value.reviewing} onClick={() => void run("bot_learning_review")}>Review now</button>
          </span>
          <label className="flex items-center gap-2 text-muted-foreground">Review model
            <select aria-label="Review model" className="min-w-0 flex-1 rounded border border-border bg-transparent px-1" value={value.reviewModel ?? ""} disabled={busy} onChange={(event) => void run("bot_learning_set", { reviewModel: event.target.value || null })}>
              <option value="">Cheapest{value.defaultModel ? ` (${value.defaultModel})` : ""}</option>
              {value.models.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
        </>
      ) : null}
      <label className="flex items-center gap-2 text-muted-foreground">
        <input type="checkbox" checked={value.consolidate} disabled={busy} onChange={(event) => void run("bot_learning_set", { consolidate: event.target.checked })} />Curator merges overlapping skills
      </label>
    </div>
  );
}
