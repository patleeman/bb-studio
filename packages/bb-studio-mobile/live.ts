// Thread Live Activities: one per thread that is running, needs you, or just
// finished, showing its latest reply and what it's asking. This module decides
// which threads get one and what each shows; server.ts pushes them.

export type LiveThread = {
  id: string;
  title: string | null;
  titleFallback: string | null;
  status: string;
  hasPendingInteraction?: boolean;
  lastReadAt: number | null;
  latestAttentionAt: number;
  parentThreadId: string | null;
  archivedAt?: number | null;
  visibility?: string;
};

export type Phase = "running" | "needsYou" | "failed" | "done";

/** What the thread is waiting on, answerable from the lock screen. */
export type Ask = {
  id: string;
  kind: "approval" | "plan" | "question";
  text: string;
  /** Option labels for a single-select question; buttons on the activity. */
  choices: string[];
};

/** Mirrors `BBThreadAttributes.ContentState` in the iOS app; keys must match. */
export type ThreadActivityState = {
  title: string;
  phase: Phase;
  /** The tail of the latest assistant text. The app truncates from the head. */
  last: string | null;
  ask: Ask | null;
  updatedAt: number;
};

export type ThreadRecord = {
  activity: { id: string; token: string; startedAt: number } | null;
  /** A push-to-start went out; the activity's own token has not arrived yet. */
  startRequestedAt: number | null;
  /** What the activity shows now. */
  state: ThreadActivityState | null;
  pushedAt: number;
  /** Swiped away while in this phase; stays away until the phase changes. */
  dismissed?: Phase | null;
};

export type ThreadAction =
  | { kind: "none" }
  /** Only the text changed, and too recently to push again; check back after `ms`. */
  | { kind: "later"; ms: number }
  | { kind: "start"; alert: string }
  | { kind: "update"; alert: string | null }
  | { kind: "end" }
  | { kind: "restart"; alert: string };

/** iOS shows a few activities at once; the rest would push these off screen. */
export const MAX_ACTIVITIES = 3;
/** A finished thread stays up this long, or until it's read. */
export const DONE_WINDOW_MS = 30 * 60 * 1000;
/** iOS ends a Live Activity after 8 hours; replace it a little before that. */
export const ACTIVITY_MAX_AGE_MS = 7.5 * 60 * 60 * 1000;
/** Give up waiting for a push-started activity's token after this long. */
export const START_TIMEOUT_MS = 10 * 60 * 1000;
/** Streaming text refreshes at most this often; phase and ask changes go out at once. */
export const TEXT_UPDATE_MS = 30_000;

const LAST_CHARS = 400;
const ASK_CHARS = 160;
const MAX_CHOICES = 3;
const CHOICE_CHARS = 40;

const RUNNING = new Set(["pending", "starting", "active", "stopping"]);
const RANK: Record<Phase, number> = { needsYou: 0, failed: 0, running: 1, done: 2 };

export function threadTitle(thread: Pick<LiveThread, "id" | "title" | "titleFallback">): string {
  return thread.title?.trim() || thread.titleFallback?.trim() || `Thread ${thread.id.slice(4, 12)}`;
}

/** Why a thread should have an activity, or null when it shouldn't. */
export function phaseOf(thread: LiveThread, now: number): Phase | null {
  if (thread.parentThreadId !== null || thread.archivedAt || thread.visibility === "hidden") return null;
  if (thread.hasPendingInteraction) return "needsYou";
  const unread = (thread.lastReadAt ?? 0) < thread.latestAttentionAt;
  if (thread.status === "error") return unread ? "failed" : null;
  if (RUNNING.has(thread.status)) return "running";
  return unread && now - thread.latestAttentionAt < DONE_WINDOW_MS ? "done" : null;
}

/** The threads that get an activity: what needs you, then running, then just finished. Showing ones keep their place. */
export function pick(
  threads: LiveThread[],
  showing: ReadonlySet<string>,
  muted: ReadonlySet<string>,
  now: number,
): Array<{ thread: LiveThread; phase: Phase }> {
  return threads
    .flatMap((thread) => {
      const phase = muted.has(thread.id) ? null : phaseOf(thread, now);
      return phase ? [{ thread, phase }] : [];
    })
    .sort(
      (a, b) =>
        RANK[a.phase] - RANK[b.phase] ||
        Number(showing.has(b.thread.id)) - Number(showing.has(a.thread.id)) ||
        b.thread.latestAttentionAt - a.thread.latestAttentionAt,
    )
    .slice(0, MAX_ACTIVITIES);
}

type InteractionPayload = {
  kind: string;
  title?: string;
  reason?: string;
  subject?: { kind?: string; command?: string; toolName?: string; tool?: string };
  questions?: Array<{ prompt?: string; multiSelect?: boolean; options?: Array<{ label: string }> }>;
  data?: { questions?: InteractionPayload["questions"] };
};

export function askOf(interaction: { id: string; payload: unknown }): Ask {
  const payload = interaction.payload as InteractionPayload;
  if (payload.kind === "approval") {
    const subject = payload.subject ?? {};
    if (subject.kind === "plan") return { id: interaction.id, kind: "plan", text: "Approve the plan?", choices: [] };
    const tool = subject.toolName ?? subject.tool;
    const text = subject.command ? `Run ${subject.command}` : tool ? `Use ${tool}` : (payload.reason ?? "Approval needed");
    return { id: interaction.id, kind: "approval", text: clip(text, ASK_CHARS), choices: [] };
  }
  const questions = payload.questions ?? payload.data?.questions;
  const question = questions?.[0];
  if (!question?.prompt) {
    return { id: interaction.id, kind: "question", text: clip(payload.title ?? "Needs your input", ASK_CHARS), choices: [] };
  }
  const choices =
    questions!.length === 1 && !question.multiSelect
      ? (question.options ?? []).slice(0, MAX_CHOICES).map((option) => clip(option.label, CHOICE_CHARS))
      : [];
  return { id: interaction.id, kind: "question", text: clip(question.prompt, ASK_CHARS), choices };
}

export function lastText(output: string | null | undefined): string | null {
  const text = output?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > LAST_CHARS ? text.slice(-LAST_CHARS) : text;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function sameContent(a: ThreadActivityState | null, b: ThreadActivityState): boolean {
  return a !== null && a.title === b.title && a.phase === b.phase && a.last === b.last && JSON.stringify(a.ask) === JSON.stringify(b.ask);
}

function alertFor(state: ThreadActivityState): string {
  switch (state.phase) {
    case "needsYou":
      return state.ask?.text ? `Needs you: ${state.ask.text}` : "Needs you";
    case "failed":
      return "Failed";
    case "done":
      return "Finished";
    case "running":
      return "Running";
  }
}

/** `next` is null when the thread shouldn't have an activity. */
export function decide(record: ThreadRecord | undefined, next: ThreadActivityState | null, now: number, canStart: boolean): ThreadAction {
  const activity = record?.activity;
  if (!next) return activity ? { kind: "end" } : { kind: "none" };
  if (activity) {
    if (now - activity.startedAt >= ACTIVITY_MAX_AGE_MS) return { kind: "restart", alert: alertFor(next) };
    const previous = record!.state;
    if (sameContent(previous, next)) return { kind: "none" };
    const onlyText = previous !== null && previous.phase === next.phase && previous.title === next.title && JSON.stringify(previous.ask) === JSON.stringify(next.ask);
    if (onlyText && now - record!.pushedAt < TEXT_UPDATE_MS) return { kind: "later", ms: TEXT_UPDATE_MS - (now - record!.pushedAt) };
    return { kind: "update", alert: previous?.phase !== next.phase && next.phase !== "running" ? alertFor(next) : null };
  }
  if (record?.dismissed === next.phase) return { kind: "none" };
  const waitingForToken = record?.startRequestedAt != null && now - record.startRequestedAt < START_TIMEOUT_MS;
  if (waitingForToken || !canStart) return { kind: "none" };
  return { kind: "start", alert: alertFor(next) };
}

/** The `aps` body for a thread activity push. Alerts light the activity up; BB's own notification makes the sound. */
export function activityPayload(
  action: Exclude<ThreadAction, { kind: "none" | "later" | "restart" }>,
  threadId: string,
  state: ThreadActivityState | null,
  now: number,
): { payload: string; priority: 5 | 10 } {
  const timestamp = Math.floor(now / 1000);
  const aps: Record<string, unknown> = { timestamp };
  if (state) aps["content-state"] = state;
  let priority: 5 | 10 = 10;
  if (action.kind === "start") {
    aps.event = "start";
    aps["attributes-type"] = "BBThreadAttributes";
    aps.attributes = { threadId };
    aps.alert = { title: state?.title ?? "BB", body: action.alert };
    // Ask iOS to hand the app this activity's update token.
    aps["input-push-token"] = 1;
  } else if (action.kind === "end") {
    aps.event = "end";
    aps["dismissal-date"] = timestamp;
  } else {
    aps.event = "update";
    if (action.alert) aps.alert = { title: state?.title ?? "BB", body: action.alert };
    else if (state?.phase === "running") priority = 5;
  }
  return { payload: JSON.stringify({ aps }), priority };
}
