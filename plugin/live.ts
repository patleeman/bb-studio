// The BB Go status Live Activity: one lock-screen summary of what is running
// and what needs you. It exists only while something is running or waiting,
// and this module decides when to start, update, and end it.

export type LiveThread = {
  id: string;
  title: string | null;
  titleFallback: string | null;
  status: string;
  hasPendingInteraction?: boolean;
  lastReadAt: number | null;
  latestAttentionAt: number;
  parentThreadId: string | null;
};

/** Mirrors `BBStatusAttributes.ContentState` in the iOS app; keys must match. */
export type LiveState = {
  needsYou: number;
  running: number;
  headline: string | null;
  headlineThreadId: string | null;
  latest: string | null;
  updatedAt: number;
};

export type LiveRecord = {
  pushToStartToken: string | null;
  activity: { id: string; token: string; startedAt: number } | null;
  /** A push-to-start went out; the activity's own token has not arrived yet. */
  startRequestedAt: number | null;
  state: LiveState | null;
};

export type LiveAction =
  | { kind: "none" }
  | { kind: "start"; state: LiveState; alert: string }
  | { kind: "update"; state: LiveState; alert: string | null }
  | { kind: "end"; state: LiveState }
  | { kind: "restart"; state: LiveState; alert: string };

export const EMPTY_RECORD: LiveRecord = { pushToStartToken: null, activity: null, startRequestedAt: null, state: null };

/** iOS ends a Live Activity after 8 hours; replace it a little before that. */
export const ACTIVITY_MAX_AGE_MS = 7.5 * 60 * 60 * 1000;
/** Give up waiting for a push-started activity's token after this long. */
export const START_TIMEOUT_MS = 10 * 60 * 1000;

const RUNNING = new Set(["pending", "starting", "active", "stopping"]);

export function threadTitle(thread: Pick<LiveThread, "id" | "title" | "titleFallback">): string {
  return thread.title?.trim() || thread.titleFallback?.trim() || `Thread ${thread.id.slice(4, 12)}`;
}

/** Waiting on an answer, or failed and not yet looked at. */
export function needsYou(thread: LiveThread): boolean {
  if (thread.hasPendingInteraction) return true;
  return thread.status === "error" && (thread.lastReadAt ?? 0) < thread.latestAttentionAt;
}

export function summarize(threads: LiveThread[], latest: string | null, now: number): LiveState {
  const top = threads.filter((thread) => thread.parentThreadId === null);
  const waiting = top.filter(needsYou).sort((a, b) => b.latestAttentionAt - a.latestAttentionAt);
  const running = top.filter((thread) => RUNNING.has(thread.status) && !needsYou(thread));
  const headlineThread = waiting[0] ?? running.sort((a, b) => b.latestAttentionAt - a.latestAttentionAt)[0];
  return {
    needsYou: waiting.length,
    running: running.length,
    headline: headlineThread ? threadTitle(headlineThread) : null,
    headlineThreadId: headlineThread?.id ?? null,
    latest,
    updatedAt: Math.floor(now / 1000),
  };
}

function sameContent(a: LiveState | null, b: LiveState): boolean {
  return (
    a !== null &&
    a.needsYou === b.needsYou &&
    a.running === b.running &&
    a.headline === b.headline &&
    a.headlineThreadId === b.headlineThreadId &&
    a.latest === b.latest
  );
}

function alertFor(previous: LiveState | null, next: LiveState): string | null {
  if (next.needsYou > (previous?.needsYou ?? 0)) {
    return next.headline ? `${next.headline} needs you` : `${next.needsYou} need you`;
  }
  return null;
}

export function decide(record: LiveRecord, next: LiveState, now: number): LiveAction {
  const active = next.needsYou + next.running > 0;
  const { activity } = record;
  if (activity) {
    if (!active) return { kind: "end", state: next };
    if (now - activity.startedAt >= ACTIVITY_MAX_AGE_MS) {
      return { kind: "restart", state: next, alert: alertFor(null, next) ?? startAlert(next) };
    }
    if (sameContent(record.state, next)) return { kind: "none" };
    return { kind: "update", state: next, alert: alertFor(record.state, next) };
  }
  if (!active) return { kind: "none" };
  const waitingForToken = record.startRequestedAt !== null && now - record.startRequestedAt < START_TIMEOUT_MS;
  if (waitingForToken || record.pushToStartToken === null) return { kind: "none" };
  return { kind: "start", state: next, alert: alertFor(null, next) ?? startAlert(next) };
}

function startAlert(state: LiveState): string {
  return state.running === 1 && state.headline ? `${state.headline} is running` : `${state.running} threads running`;
}

/** The `aps` body for a Live Activity push. */
export function livePayload(
  action: Exclude<LiveAction, { kind: "none" | "restart" }>,
  now: number,
): { payload: string; priority: 5 | 10 } {
  const timestamp = Math.floor(now / 1000);
  const aps: Record<string, unknown> = { timestamp, "content-state": action.state };
  let priority: 5 | 10 = 10;
  if (action.kind === "start") {
    aps.event = "start";
    aps["attributes-type"] = "BBStatusAttributes";
    aps.attributes = {};
    aps.alert = { title: "BB", body: action.alert };
    // Ask iOS to hand the app this activity's update token.
    aps["input-push-token"] = 1;
  } else if (action.kind === "end") {
    aps.event = "end";
    // Leave "All clear" up briefly, then remove the activity.
    aps["dismissal-date"] = timestamp + 60;
  } else {
    aps.event = "update";
    if (action.alert) {
      aps.alert = { title: "BB", body: action.alert, sound: "default" };
    } else {
      priority = 5;
    }
  }
  return { payload: JSON.stringify({ aps }), priority };
}
