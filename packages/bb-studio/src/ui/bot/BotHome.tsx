// The Bot page (nav panel `bot`, /plugins/studio/bot[/<botId>]): the
// selected Bot's Info (BotTabs.tsx), with BB's sidebar showing the Bots list
// (BotSidebar.tsx). The bare /plugins/studio/bot (the rail's Bot item) opens
// the window's last Bot thread, or the Bot's chat, and shows the primary's
// Info only when there's neither. A Bot's chat isn't embedded here: it opens as BB's own
// thread page, from the Bots list or Info's Open chat. With no Bot yet, the
// page is a welcome that asks what the Bot should help with; Create makes it
// and opens its chat, where it sets itself up. "New bot"
// (/plugins/studio/bot/new) does the same for another Bot.
// The route picks the Bot (selection.ts); Studio's old address redirects here.
import { errorMessage, relativeTime } from "@bb-studio/kit/format";
import { DANGER_BUTTON, GHOST_BUTTON, OUTLINE_BUTTON, openAppPath, PageColumn, PRIMARY_BUTTON, usePathname } from "@bb-studio/kit/app";
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon, Input, Textarea } from "@bb-studio/kit/ui";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { BotActivityView, BotAvatarHistoryView, BotLearningView, BotScheduledView, BotSkillView, BotThreadView, BotView, HeartbeatRun } from "../../contract";
import { pagePath } from "../../pages/constants";
import { describeCron } from "../../schedule";
import { useCall, useLive } from "../live";
import { HeartbeatFields, useHeartbeatForm } from "../ProjectLeads";
import { BOT_COLORS, BOT_SHAPES, BotAvatar, colorForName, DEFAULT_SHAPE } from "./BotAvatar";
import { Welcome } from "./Onboarding";
import { useOpenThread } from "./workspace";
import { botLanding, readLastBotThread, threadRoute } from "./threadListSwitch";
import { BOT_PATH, botPath, forBot, rememberBot, useBotSelection } from "./selection";

/** The Bot's nav panel: its id and path under /plugins/studio. */
export const BOT_PANEL = "bot";
export { BOT_PATH };
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
  const run = async (method: string, input: object = {}) => {
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
  const view = useLive<BotView>("bot_get", forBot(creating ? undefined : botId), { pollMs: 30_000 });
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

/** Studio's old address (/plugins/studio/studio/bot): replaced by the Bot's own panel. */
export function BotRedirect() {
  useEffect(() => { openAppPath(BOT_PATH, { replace: true }); }, []);
  return null;
}

/** shape null: the emoji avatar. */
type Profile = { name: string; shape: string | null; color: string | null; role: string; emoji: string };

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
    ? { shape: DEFAULT_SHAPE as string, color: BOT_COLORS[0] as string, emoji: "🤖" }
    : { shape: (BOT_SHAPES[3] ?? DEFAULT_SHAPE) as string, color: (BOT_COLORS[2] ?? BOT_COLORS[0]) as string, emoji: "🤖" };
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

export type Sheet = "profile" | "skills" | "checkins" | "stop" | null;

/** The Bot's controls, shared by the page and its Info tab: RPCs, dialogs, and opening its Memory. */
export function useBotControls(view: BotView, refresh: () => void, running: number) {
  const bot = view.bot!;
  const { run, busy, error } = useAction(refresh, bot.id);
  const [sheet, setSheet] = useState<Sheet>(null);
  const profile: Profile = { name: bot.name, shape: bot.shape ?? null, color: bot.color ?? null, role: bot.role ?? "", emoji: bot.avatar };
  const openMemory = async () => {
    const memory = bot.memoryPageId ? { pageId: bot.memoryPageId } : await run("bot_memory") as { pageId: string | null } | null;
    if (memory?.pageId) openAppPath(pagePath(memory.pageId));
  };
  const sheets = (
    <>
      {sheet === "profile" || sheet === "skills" ? (
        <ProfileDialog value={profile} advancedOpen={sheet === "skills"} advanced={bot.kind === "external" ? undefined : <SkillsList botId={bot.id} name={bot.name} />} onClose={() => setSheet(null)}
          images={<AvatarImages botId={bot.id} onChanged={refresh} />}
          onSave={(next) => {
            setSheet(null);
            const input = {
              ...(next.name !== bot.name ? { name: next.name } : {}),
              ...(next.shape !== (bot.shape ?? null) ? { shape: next.shape } : {}),
              ...(next.emoji.trim() && next.emoji.trim() !== bot.avatar ? { avatar: next.emoji.trim() } : {}),
              ...(next.color && next.color !== bot.color ? { color: next.color } : {}),
              ...(next.role.trim() !== (bot.role ?? "") ? { role: next.role.trim() } : {}),
            };
            if (Object.keys(input).length) void run("bot_set", input);
          }} />
      ) : null}
      {sheet === "checkins" ? (
        <CheckinsDialog run={view.run} busy={!!busy} onClose={() => setSheet(null)}
          onPreset={(preset) => { setSheet(null); void run("bot_checkin_preset", { preset }); }}
          onSave={(input) => { setSheet(null); void run("bot_set_run", input as object); }} />
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
  return { bot, profile, run, busy, error, setSheet, openMemory, sheets };
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
          <span className="shrink-0 text-xs text-muted-foreground" title={item.cron ? describeCron(item.cron) : undefined}>{!item.enabled ? "off" : item.nextRunAt ? when(item.nextRunAt) : item.cron ? describeCron(item.cron) : "on"}</span>
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

/**
 * Edit profile: the avatar (an image it made or you uploaded, else drawn: a
 * shape and color, or an emoji), its name, and the role it's given. Advanced
 * holds its skills. Picking an image applies at once; the rest on Save.
 */
function ProfileDialog({ value, advanced, advancedOpen = false, images, onClose, onSave }: { value: Profile; advanced?: ReactNode; advancedOpen?: boolean; images?: ReactNode; onClose(): void; onSave(next: Profile): void }) {
  const [draft, setDraft] = useState<Profile>({ ...value, color: value.color ?? colorForName(value.name) });
  const [showAdvanced, setShowAdvanced] = useState(advancedOpen);
  const patch = (next: Partial<Profile>) => setDraft({ ...draft, ...next });
  const save = () => { if (draft.name.trim()) onSave({ ...draft, name: draft.name.trim(), emoji: draft.emoji.trim() || value.emoji }); };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit profile</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex justify-center"><BotAvatar shape={draft.shape} color={draft.color} emoji={draft.emoji || "🤖"} size={72} /></div>
          {images}
          <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label="Shape">
            {BOT_SHAPES.map((shape) => (
              <button key={shape} type="button" role="radio" aria-checked={draft.shape === shape} aria-label={`Shape ${shape}`} onClick={() => patch({ shape })}
                className="flex aspect-square items-center justify-center rounded-md hover:bg-state-hover aria-checked:bg-state-active aria-checked:ring-1 aria-checked:ring-border">
                <BotAvatar shape={shape} color={draft.color} emoji="" size={26} />
              </button>
            ))}
            <button type="button" role="radio" aria-checked={draft.shape === null} aria-label="Emoji" title="Emoji" onClick={() => patch({ shape: null })}
              className="flex aspect-square items-center justify-center rounded-md hover:bg-state-hover aria-checked:bg-state-active aria-checked:ring-1 aria-checked:ring-border">
              <BotAvatar shape={null} emoji={draft.emoji || "🤖"} size={26} />
            </button>
          </div>
          {draft.shape === null ? (
            <label className="flex items-center gap-2">
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

/** The largest image Upload sends (Studio keeps at most 4 MB). */
const UPLOAD_MAX = 4 * 1024 * 1024;

/** Its image avatars: the drawn one, the last few images (made by it or uploaded), Upload, and Revert to the one before. */
function AvatarImages({ botId, onChanged }: { botId: string; onChanged(): void }) {
  const history = useLive<BotAvatarHistoryView>("bot_avatar_history", { botId }, { pollMs: 60_000 });
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
  const skills = useLive<{ skills: BotSkillView[] }>("bot_skills", { botId }, { pollMs: 30_000 });
  const learning = useLive<BotLearningView>("bot_learning", { botId }, { pollMs: 30_000 });
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
      {learning.data?.pending.length ? (
        <div className="flex flex-col gap-1" aria-label="Waiting for approval">
          <span className="text-xs font-medium">Waiting for your approval</span>
          {learning.data.pending.map((change) => (
            <div key={change.id} className="flex flex-col gap-1 rounded-md border border-border p-2">
              <span className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate font-medium">{change.action === "delete" ? `Delete ${change.name}` : change.name}</span>
                <button type="button" className={GHOST_BUTTON} disabled={!!busy} onClick={() => void run("bot_skill_pending_resolve", { id: change.id, approve: true })}>Approve</button>
                <button type="button" className={GHOST_BUTTON} disabled={!!busy} onClick={() => void run("bot_skill_pending_resolve", { id: change.id, approve: false })}>Reject</button>
              </span>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{change.diff}</pre>
            </div>
          ))}
        </div>
      ) : null}
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
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

const LEARN_INTERVALS = [5, 10, 20, 30, 50];

/** Learn from work: the background review's switch, interval and model, approval, and the last result. */
function LearnSettings({ value, busy, run }: { value: BotLearningView; busy: boolean; run(method: string, input?: object): Promise<unknown> }) {
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
          <label className="flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={value.approval} disabled={busy} onChange={(event) => void run("bot_learning_set", { approval: event.target.checked })} />Review skills before saving
          </label>
        </>
      ) : null}
      <label className="flex items-center gap-2 text-muted-foreground">
        <input type="checkbox" checked={value.consolidate} disabled={busy} onChange={(event) => void run("bot_learning_set", { consolidate: event.target.checked })} />Curator merges overlapping skills
      </label>
    </div>
  );
}
