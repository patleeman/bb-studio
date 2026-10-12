// The Bot's own page (nav panel `bot`, /plugins/studio/bot), chat-first like
// a messaging app: its drawn avatar, name and live status centered on top,
// its chat filling the page, a Needs-you banner only when something waits on
// the user, and Activity as a floating card behind the list button. The ⋯
// menu holds the rest. With no Bot yet, the page greets the user as one and
// the first message makes it. Studio's old address redirects here.
import { errorMessage } from "@bb-studio/kit/format";
import { DANGER_BUTTON, GHOST_BUTTON, ICON_BUTTON, openAppPath, OUTLINE_BUTTON, PageColumn, PRIMARY_BUTTON } from "@bb-studio/kit/app";
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
import { BOT_COLORS, BOT_SHAPES, BotAvatar, colorForName, DEFAULT_SHAPE } from "./BotAvatar";

/** The Bot's nav panel: its id and path under /plugins/studio. */
export const BOT_PANEL = "bot";
export const BOT_PATH = `/plugins/studio/${BOT_PANEL}`;
/** Studio's old address for the Bot (/plugins/studio/studio/bot), which redirects. */
export const BOT_SUBPATH = "bot";
const ACTIVITY_KEY = "studio.bot.activity";
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
function Identity({ avatar, profile, status, dot, onEdit }: { avatar: string; profile: Profile; status: string; dot: string; onEdit(): void }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button type="button" className="group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Edit profile" onClick={onEdit}>
        <BotAvatar shape={profile.shape} color={profile.color} emoji={avatar} size={56} />
        <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground group-hover:text-foreground" aria-hidden><Icon name="Edit" className="size-3" /></span>
      </button>
      <h1 className="mt-1.5 max-w-full truncate text-sm font-semibold">{profile.name}</h1>
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
  const [message, setMessage] = useState("");
  const { run, busy, error } = useAction(onCreated);
  const send = async () => {
    const made = await run("bot_create", { name: profile.name, avatar: "🤖", shape: profile.shape ?? DEFAULT_SHAPE, color: profile.color ?? BOT_COLORS[0], ...(message.trim() ? { prompt: message.trim() } : {}) });
    if (made && profile.role.trim()) await run("bot_set", { role: profile.role.trim() });
  };
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="shrink-0 px-24 pt-5 pb-3"><Identity avatar="🤖" profile={profile} status="New" dot="bg-muted-foreground/50" onEdit={() => setEditing(true)} /></header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 py-6">
          <Bubble>Hey! I'm your bot. I see every project, check in on a schedule and tell you what needs you.</Bubble>
          <Bubble>Want to give me a name and a look? Or just tell me what to keep an eye on.</Bubble>
          <div className="pl-1">
            <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-3 text-xs hover:bg-state-hover" onClick={() => setEditing(true)}>
              Customize your bot<Icon name="ChevronRight" className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-2xl shrink-0 px-4 pb-5">
        {error ? <p role="alert" className="mb-2 text-sm text-destructive">{error}</p> : null}
        <div className="flex items-end gap-2 rounded-3xl border border-border bg-foreground/[0.03] py-1.5 pr-1.5 pl-4">
          <Textarea aria-label="First message" rows={1} placeholder="Send a message" value={message} disabled={!!busy}
            className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-0 py-2 shadow-none focus-visible:ring-0"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
          <button type="button" aria-label="Send" disabled={!!busy} onClick={() => void send()}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50"><Icon name="ArrowUp" className="size-4" /></button>
        </div>
      </div>
      {editing ? <ProfileDialog value={profile} onClose={() => setEditing(false)} onSave={(next) => { setProfile(next); setEditing(false); }} /> : null}
    </div>
  );
}

function Bubble({ children }: { children: ReactNode }) {
  return <p className="max-w-[85%] self-start rounded-2xl rounded-bl-md bg-foreground/[0.06] px-3.5 py-2 text-sm">{children}</p>;
}

/** Whether the Activity card is open; closed by default, remembered on this device. */
function useActivityOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(ACTIVITY_KEY) === "open"; } catch { return false; } });
  const set = (next: boolean) => {
    try { localStorage.setItem(ACTIVITY_KEY, next ? "open" : "closed"); } catch { /* private mode */ }
    setOpen(next);
  };
  return [open, set];
}

type Sheet = "profile" | "skills" | "checkins" | "stop" | null;

function BotPage({ view, refresh }: { view: BotView; refresh(): void }) {
  const bot = view.bot!;
  const activity = useLive<BotActivityView>("bot_activity", {}, { pollMs: 15_000 });
  const refreshAll = () => { refresh(); activity.refresh(); };
  const { run, busy, error } = useAction(refreshAll);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [activityOpen, setActivityOpen] = useActivityOpen();
  const data = activity.data;
  const needsYou = data?.needsYou ?? [];
  const running = data?.inProgress.filter((thread) => thread.relation === "started").length ?? 0;
  const profile: Profile = { name: bot.name, shape: bot.shape ?? null, color: bot.color ?? null, role: bot.role ?? "" };
  const status = statusLabel(view.run, bot.state, running);

  const openMemory = async () => {
    const memory = bot.memoryPageId ? { pageId: bot.memoryPageId } : await run("bot_memory") as { pageId: string | null } | null;
    if (memory?.pageId) openAppPath(pagePath(memory.pageId));
  };

  return (
    <div className="studio-root relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="relative shrink-0 px-24 pt-5 pb-3">
        <Identity avatar={bot.avatar} profile={profile} status={status} dot={STATE_DOT[bot.state]} onEdit={() => setSheet("profile")} />
        <div className="absolute top-3 right-3 flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={ICON_BUTTON} aria-label="Bot menu" disabled={!!busy}><Icon name="MoreHorizontal" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onSelect={() => setSheet("profile")}><Icon name="Edit" />Edit profile…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void openMemory()}><Icon name="FileText" />Memory</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSheet("skills")}><Icon name="ListTodo" />Skills…</DropdownMenuItem>
              {bot.state === "active" ? <DropdownMenuItem onSelect={() => setSheet("checkins")}><Icon name="Calendar" />Check-ins…</DropdownMenuItem> : null}
              {bot.threadId ? <DropdownMenuItem onSelect={() => openAppPath(threadPath(bot.threadId!))}><Icon name="ExternalLink" />Open as thread</DropdownMenuItem> : null}
              <DropdownMenuSeparator />
              {bot.state === "active"
                ? <DropdownMenuItem onSelect={() => void run("bot_pause")}><Icon name="Pause" />Pause</DropdownMenuItem>
                : <DropdownMenuItem onSelect={() => void run("bot_resume")}><Icon name="Play" />Resume</DropdownMenuItem>}
              {bot.state !== "stopped" ? <DropdownMenuItem variant="destructive" onSelect={() => setSheet("stop")}><Icon name="Square" />Stop…</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className={`${ICON_BUTTON} relative`} aria-label={activityOpen ? "Hide activity" : "Show activity"} aria-pressed={activityOpen} title="Activity" onClick={() => setActivityOpen(!activityOpen)}>
            <Icon name="ListView" />
            {needsYou.length ? <span className="absolute top-1 right-1 size-1.5 rounded-full bg-warning" aria-hidden /> : null}
          </button>
        </div>
      </header>

      {error ? <p role="alert" className="mx-auto w-full max-w-2xl shrink-0 px-4 pb-2 text-sm text-destructive">{error}</p> : null}
      {bot.state !== "active" ? (
        <div className="mx-auto mb-2 flex w-full max-w-2xl shrink-0 items-center gap-3 px-4 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1">{bot.name} is {bot.state}. Check-ins are off and it won't start new work.</span>
          <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => void run("bot_resume")}><Icon name="Play" />Resume</button>
        </div>
      ) : null}
      {needsYou.length ? <NeedsYouBanner threads={needsYou} /> : null}
      {bot.threadId ? (
        <section aria-label="Chat" className="min-h-0 flex-1">
          <ThreadChat threadId={bot.threadId} variant="full" className="h-full" />
        </section>
      ) : (
        <p className="m-auto max-w-sm text-center text-sm text-muted-foreground">{bot.name} has no chat. Make a thread your Bot from its ⋯ menu.</p>
      )}

      {activityOpen ? (
        <aside aria-label="Activity" className="absolute top-14 right-3 z-20 flex max-h-[calc(100%-4.5rem)] w-80 max-w-[calc(100%-1.5rem)] flex-col overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center gap-2.5 px-3 pt-3">
            <BotAvatar shape={profile.shape} color={profile.color} emoji={bot.avatar} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{bot.name}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={`size-1.5 rounded-full ${STATE_DOT[bot.state]}`} aria-hidden /><span className="truncate">{status}</span></div>
            </div>
            <button type="button" className={ICON_BUTTON} aria-label="Close activity" onClick={() => setActivityOpen(false)}><Icon name="X" /></button>
          </div>
          <div className="flex gap-2 px-3 pt-3">
            {bot.threadId ? <button type="button" className={`${OUTLINE_BUTTON} flex-1 justify-center`} onClick={() => openAppPath(threadPath(bot.threadId!))}><Icon name="ExternalLink" />Open thread</button> : null}
            {bot.state === "active" ? <button type="button" className={`${OUTLINE_BUTTON} flex-1 justify-center`} onClick={() => setSheet("checkins")}><Icon name="Calendar" />Check-ins</button> : null}
          </div>
          <ActivityPanel data={data} loading={activity.loading} error={activity.error} />
        </aside>
      ) : null}

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
      {sheet === "checkins" ? <CheckinsDialog run={view.run} busy={!!busy} onClose={() => setSheet(null)} onSave={(input) => { setSheet(null); void run("bot_set_run", input); }} /> : null}
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
    </div>
  );
}

function statusLabel(run: HeartbeatRun | null, state: keyof typeof STATE_LABEL, running = 0): string {
  if (state !== "active") return STATE_LABEL[state];
  if (running) return `Working on ${running} thread${running === 1 ? "" : "s"}`;
  if (!run?.enabled) return "Idle";
  const cadence = run.cadence === "custom" ? "on a schedule" : run.cadence.replace(/^every(\d+)(minutes|hours)$/, "every $1 $2").replace(/^every(\w)/, "every $1");
  return `Checks in ${cadence}${run.time && /daily|weekdays|weekly/.test(run.cadence) ? ` at ${run.time}` : ""}`;
}

/** What waits on the user, between the header and the chat: one row per thread, each opens it. */
function NeedsYouBanner({ threads }: { threads: BotThreadView[] }) {
  return (
    <section aria-label="Needs you" className="mx-auto mb-2 w-full max-w-2xl shrink-0 px-4">
      <ul className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
        {threads.map((thread) => (
          <li key={thread.id} className="flex min-w-0 items-center gap-2 text-sm">
            <Icon name="AlertCircle" className="size-4 shrink-0 text-warning" />
            <span className="min-w-0 flex-1 truncate"><span className="text-muted-foreground">Needs you · </span>{thread.relation === "self" ? "Its chat" : thread.title}</span>
            <button type="button" className="h-7 shrink-0 rounded-md px-2 text-sm font-medium hover:bg-state-hover" onClick={() => openAppPath(threadPath(thread.id))}>Answer</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Activity's sections: each a quiet line when empty; Waiting to start only when something waits. */
export function ActivityPanel({ data, loading, error }: { data: BotActivityView | null | undefined; loading: boolean; error?: string | null }) {
  const [allRecent, setAllRecent] = useState(false);
  if (!data) return <p className="px-4 py-3 text-xs text-muted-foreground">{loading ? "Loading…" : ""}</p>;
  const recent = allRecent ? data.completed : data.completed.slice(0, COMPLETED_PREVIEW);
  return (
    <div className="flex flex-col gap-3 px-1.5 pt-3 pb-2">
      <Section title="Needs you" empty="Nothing needs you">{data.needsYou.length ? <ThreadList threads={data.needsYou} /> : null}</Section>
      {data.waiting?.length ? <Section title="Waiting to start" empty="">{<ThreadList threads={data.waiting} />}</Section> : null}
      <Section title="Running" empty="Nothing running">{data.inProgress.length ? <ThreadList threads={data.inProgress} /> : null}</Section>
      <Section title="Scheduled" empty="No check-ins scheduled">{data.scheduled.length ? <ScheduledList items={data.scheduled} /> : null}</Section>
      <Section title="Recent" empty="No recent activity">
        {data.completed.length ? (
          <>
            <ThreadList threads={recent} />
            {data.completed.length > COMPLETED_PREVIEW ? (
              <button type="button" className="self-start px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAllRecent(!allRecent)}>
                {allRecent ? "Show fewer" : `Show all ${data.completed.length}`}
              </button>
            ) : null}
          </>
        ) : null}
      </Section>
      {error ? <p role="alert" className="px-1.5 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <h3 className="px-1.5 pb-0.5 text-xs font-medium text-muted-foreground">{title}</h3>
      {children ?? <p className="px-1.5 text-sm text-muted-foreground/70">{empty}</p>}
    </section>
  );
}

function ThreadList({ threads }: { threads: BotThreadView[] }) {
  return (
    <ul className="flex flex-col">
      {threads.map((thread) => (
        <li key={thread.id}>
          <button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-state-hover" onClick={() => openAppPath(threadPath(thread.id))}>
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

function CheckinsDialog({ run, busy, onClose, onSave }: { run: HeartbeatRun | null; busy: boolean; onClose(): void; onSave(input: unknown): void }) {
  const form = useHeartbeatForm(run);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Check-ins</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3 text-sm"><HeartbeatFields form={form} disabled={busy} needs={null} /></div>
        <DialogFooter>
          <button type="button" className={GHOST_BUTTON} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => onSave(form.input())}>Save</button>
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
