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
 * The replies to offer, or null for none: Reactions missing, disabled,
 * failed, not answering, or with smart reactions off.
 */
export async function reactionReplies(sdk: RepliesSdk, defaults: readonly string[], timeoutMs = REPLIES_TIMEOUT_MS): Promise<readonly string[] | null> {
  try {
    const { plugins } = await withTimeout(sdk.plugins.list(), timeoutMs);
    const reactions = plugins.find((plugin) => plugin.id === REACTIONS_PLUGIN_ID);
    if (!reactions?.enabled || (reactions.status !== undefined && !LOADED.has(reactions.status))) return null;
    const { values } = await withTimeout(sdk.plugins.getSettings({ pluginId: REACTIONS_PLUGIN_ID, signal: AbortSignal.timeout(timeoutMs) }), timeoutMs);
    if (values.smartReactions !== true) return null;
    return preferredReplies(values.emojiItems) ?? defaults;
  } catch {
    return null;
  }
}

export interface RepliesTracker {
  /** The latest answer; `configure` is synchronous. */
  current(): readonly string[] | null;
  /** Rechecks now; the newest check wins. */
  refresh(): Promise<readonly string[] | null>;
  dispose(): void;
}

/** Keeps `reactionReplies` current on system changes, session starts and a timer. */
export function trackReactionReplies(sdk: RepliesSdk, defaults: readonly string[], timeoutMs = REPLIES_TIMEOUT_MS): RepliesTracker {
  let current: readonly string[] | null = null;
  let latest = 0;
  const refresh = async () => {
    const id = ++latest;
    const replies = await reactionReplies(sdk, defaults, timeoutMs);
    if (id === latest) current = replies;
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
      clearInterval(timer);
      unsubscribe?.();
    },
  };
}
