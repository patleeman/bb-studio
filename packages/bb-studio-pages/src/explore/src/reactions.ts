// The Next row's quick replies follow Studio Reactions: they're offered only
// while Reactions is loaded with smart reactions on, using its saved
// reactions when it has some. Otherwise the Next row has no reply group.
import { preferredReplies, REACTIONS_PLUGIN_ID } from "./next";

/** Backstop recheck; BB's system events and session starts recheck sooner. */
export const REPLIES_REFRESH_MS = 15_000;
export const REPLIES_TIMEOUT_MS = 10_000;

const LOADED = new Set(["running", "degraded", "starting"]);

interface RepliesSdk {
  plugins: {
    list(): Promise<{ plugins: readonly { id: string; enabled: boolean; status?: string }[] }>;
    getSettings(args: { pluginId: string; signal?: AbortSignal }): Promise<{ values: Record<string, unknown> }>;
  };
  subscribe?(args: { event: "system:changed"; callback: (event: unknown) => void }): () => void;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The replies to offer, null for none (Reactions missing, disabled, failed or
 * with smart reactions off), or undefined when the check itself couldn't be
 * done (the plugin list or settings didn't answer in time): that says nothing
 * about whether Reactions is on.
 */
export async function checkReactionReplies(sdk: RepliesSdk, defaults: readonly string[], timeoutMs = REPLIES_TIMEOUT_MS): Promise<readonly string[] | null | undefined> {
  try {
    const { plugins } = await withTimeout(sdk.plugins.list(), timeoutMs);
    const reactions = plugins.find((plugin) => plugin.id === REACTIONS_PLUGIN_ID);
    if (!reactions?.enabled || (reactions.status !== undefined && !LOADED.has(reactions.status))) return null;
    const { values } = await withTimeout(sdk.plugins.getSettings({ pluginId: REACTIONS_PLUGIN_ID, signal: AbortSignal.timeout(timeoutMs) }), timeoutMs);
    if (values.smartReactions !== true) return null;
    return preferredReplies(values.emojiItems) ?? defaults;
  } catch {
    return undefined;
  }
}

/** The replies to offer, or null for none, including when the check couldn't be done. */
export async function reactionReplies(sdk: RepliesSdk, defaults: readonly string[], timeoutMs = REPLIES_TIMEOUT_MS): Promise<readonly string[] | null> {
  return (await checkReactionReplies(sdk, defaults, timeoutMs)) ?? null;
}

/** Where the last known answer survives a restart (the plugin's kv storage). */
export interface RepliesMemory {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}
const MEMORY_KEY = "explore:replies";

export interface RepliesTracker {
  /** The latest answer (`configure` is synchronous), or undefined while nothing is known yet. */
  current(): readonly string[] | null | undefined;
  /** Rechecks now; the newest check wins, and a check that fails keeps the last known answer. */
  refresh(): Promise<readonly string[] | null | undefined>;
  dispose(): void;
}

/**
 * Keeps the answer current on system changes, session starts and a timer.
 * Only a check that succeeds changes it, so a slow or failed one never turns
 * replies off; with a `memory`, the last answer is there again after a restart.
 */
export function trackReactionReplies(sdk: RepliesSdk, defaults: readonly string[], timeoutMs = REPLIES_TIMEOUT_MS, memory?: RepliesMemory): RepliesTracker {
  let current: readonly string[] | null | undefined;
  let latest = 0;
  let applied = 0;
  let disposed = false;
  void memory?.get<{ replies: string[] | null }>(MEMORY_KEY).then(
    (saved) => {
      if (!disposed && applied === 0 && saved && (saved.replies === null || Array.isArray(saved.replies))) current = saved.replies;
    },
    () => undefined,
  );
  const refresh = async () => {
    const id = ++latest;
    const replies = await checkReactionReplies(sdk, defaults, timeoutMs);
    if (replies !== undefined && id > applied) {
      applied = id;
      current = replies;
      void memory?.set(MEMORY_KEY, { replies }).catch(() => undefined);
    }
    return current;
  };
  void refresh();
  const timer = setInterval(() => void refresh(), REPLIES_REFRESH_MS);
  (timer as { unref?: () => void }).unref?.();
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = sdk.subscribe?.({ event: "system:changed", callback: () => void refresh() });
  } catch {
    // No realtime events: the session-start check and the timer still apply.
  }
  return {
    current: () => current,
    refresh,
    dispose() {
      disposed = true;
      clearInterval(timer);
      unsubscribe?.();
    },
  };
}
