// The Spaces thread list's pure logic: which Space each thread is in, how a
// Space's threads are laid out, row states, and the switcher's order.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export type Thread = PluginSidebarThread;

/** The parts of a Studio Space the list shows. */
export interface StudioSpace {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  defaultProjectId: string | null;
  /** Studio's default Space (Home): threads in no Space belong to it. */
  isDefault: boolean;
  /** Projects the Space owns: their threads are in it unless added elsewhere. */
  projectIds: readonly string[];
}

/** The `currentSpace` value for All, which stacks every Space. */
export const ALL_SPACES = "all";

/** The default Space: Studio's flagged one, else the first. */
export function defaultSpaceId(spaces: readonly StudioSpace[]): string | null {
  return (spaces.find((space) => space.isDefault) ?? spaces[0])?.id ?? null;
}

/** The root of a thread's tree among `byId`, guarding against cycles. */
function rootOf(thread: Thread, byId: ReadonlyMap<string, Thread>): Thread {
  let root = thread;
  const seen = new Set([thread.id]);
  while (root.parentThreadId) {
    const parent = byId.get(root.parentThreadId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    root = parent;
  }
  return root;
}

/**
 * Which Space a thread shows under. A child stays with its root's Space so a
 * tree is never split; then the thread's own Space, its project's Space, and
 * finally the default Space. Unknown Space ids count as none.
 */
export function createSpaceResolver(
  threads: readonly Thread[],
  spaceOf: Readonly<Record<string, string>>,
  spaces: readonly StudioSpace[],
): (thread: Thread) => string | null {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const ids = new Set(spaces.map((space) => space.id));
  const byProject = new Map(spaces.flatMap((space) => space.projectIds.map((projectId) => [projectId, space.id] as const)));
  const fallback = defaultSpaceId(spaces);
  const known = (id: string | undefined) => (id !== undefined && ids.has(id) ? id : null);
  return (thread) => {
    const root = rootOf(thread, byId);
    return known(spaceOf[root.id]) ?? known(spaceOf[thread.id]) ?? known(byProject.get(root.projectId)) ?? fallback;
  };
}

/** One thread and its sub-threads, as the list nests them. */
export interface ThreadNode {
  thread: Thread;
  children: ThreadNode[];
}

export interface SpaceGroup {
  space: StudioSpace;
  lead: ThreadNode | null;
  /** Pinned trees, in pin order. */
  pinned: ThreadNode[];
  /** Every other tree, threads that need you first, then newest. */
  rest: ThreadNode[];
  /** Every thread in the Space, nested or not. */
  all: Thread[];
}

export type ThreadState = "needs-you" | "working" | "error" | "unread" | "idle";

const BUSY = new Set(["starting", "active", "stopping", "provisioning"]);

/** What a thread asks of the user, most urgent first. */
export function threadState(
  thread: Pick<Thread, "status" | "runtimeStatus" | "indicator" | "hasPendingInteraction" | "isUnread">,
): ThreadState {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "needs-you";
  if (BUSY.has(thread.status) || BUSY.has(thread.runtimeStatus) || thread.indicator === "runtime") return "working";
  if (thread.indicator === "unread-error") return "error";
  if (thread.indicator === "unread-success" || thread.isUnread) return "unread";
  return "idle";
}

// A question blocks its thread, so it outranks a failure, which outranks a result.
const WAIT_RANK: Record<ThreadState, number> = { "needs-you": 0, error: 1, unread: 2, working: 3, idle: 3 };

const recency = (thread: Thread) => Math.max(thread.updatedAt, thread.latestAttentionAt);

function flatten(node: ThreadNode): Thread[] {
  return [node.thread, ...node.children.flatMap(flatten)];
}

function rankOf(node: ThreadNode): number {
  return Math.min(...flatten(node).map((thread) => WAIT_RANK[threadState(thread)]));
}

/** Nests threads under their parents; a thread whose parent isn't listed is a root. */
export function buildTrees(threads: readonly Thread[]): ThreadNode[] {
  const nodes = new Map(threads.map((thread) => [thread.id, { thread, children: [] as ThreadNode[] }]));
  const roots: ThreadNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.thread.parentThreadId ? nodes.get(node.thread.parentThreadId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: ThreadNode[]) => {
    list.sort((a, b) => recency(b.thread) - recency(a.thread));
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

/**
 * One group per Space in Studio's order. In each: the lead's tree, then
 * pinned trees in pin order, then the rest with threads that need you first.
 */
export function buildSpaceGroups(
  threads: readonly Thread[],
  spaces: readonly StudioSpace[],
  spaceOf: Readonly<Record<string, string>>,
  leads: Readonly<Record<string, string | null>>,
): SpaceGroup[] {
  const resolve = createSpaceResolver(threads, spaceOf, spaces);
  const bySpace = new Map<string, Thread[]>();
  for (const thread of threads) {
    const spaceId = resolve(thread);
    if (spaceId === null) continue;
    bySpace.set(spaceId, [...(bySpace.get(spaceId) ?? []), thread]);
  }
  return spaces.map((space) => {
    const all = bySpace.get(space.id) ?? [];
    const trees = buildTrees(all);
    const leadId = leads[space.id] ?? null;
    const lead = trees.find((node) => node.thread.id === leadId) ?? null;
    const pinOrder = (thread: Thread) => thread.pinSortKey ?? `~${String(thread.pinnedAt ?? 0).padStart(15, "0")}`;
    const pinned = trees
      .filter((node) => node !== lead && node.thread.isPinned)
      .sort((a, b) => pinOrder(a.thread).localeCompare(pinOrder(b.thread)));
    const rest = trees
      .filter((node) => node !== lead && !node.thread.isPinned)
      .map((node) => ({ node, rank: rankOf(node) }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ node }) => node);
    return { space, lead, pinned, rest, all };
  });
}

/** Spaces with a thread that needs the user. */
export function spacesNeedingYou(threads: readonly Thread[], resolve: (thread: Thread) => string | null): Set<string> {
  return new Set(threads.flatMap((thread) => {
    const spaceId = threadState(thread) === "needs-you" ? resolve(thread) : null;
    return spaceId ? [spaceId] : [];
  }));
}

/** The view before or after `currentId` (All, then each Space), wrapping around. */
export function neighbourSpaceId(spaces: readonly StudioSpace[], currentId: string | null, step: -1 | 1): string | null {
  if (!spaces.length) return null;
  const ids = [ALL_SPACES, ...spaces.map((space) => space.id)];
  const index = ids.indexOf(currentId ?? "");
  return ids[((index < 0 ? 1 : index) + step + ids.length) % ids.length]!;
}

/** The stored `currentSpace` read against the Spaces: All, a Space, or the default Space. */
export function resolveCurrentSpace(spaces: readonly StudioSpace[], stored: string | null): string | null {
  if (stored === ALL_SPACES && spaces.length) return ALL_SPACES;
  if (stored && spaces.some((space) => space.id === stored)) return stored;
  return defaultSpaceId(spaces);
}

/** "now", "5m", "3h", "2d", "3w", "4mo" or "1y" since `at`. */
export function compactAge(at: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** `thread_lines` takes at most this many threads. */
export const THREAD_LINES_LIMIT = 60;

/** The threads to ask Studio about: leads first, then the rest by recency, capped. */
export function threadLineIds(leads: readonly Thread[], rest: readonly Thread[]): string[] {
  const ids = new Set(leads.map((thread) => thread.id));
  for (const thread of [...rest].sort((a, b) => recency(b) - recency(a))) ids.add(thread.id);
  return [...ids].slice(0, THREAD_LINES_LIMIT);
}

/**
 * The threads to drop: hidden ones and their sub-threads, except pinned
 * trees, the open thread's ancestry, and leads.
 */
export function hiddenThreadIds(
  threads: readonly Thread[],
  hidden: readonly string[],
  keep: ReadonlySet<string>,
): Set<string> {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const hiddenSet = new Set(hidden);
  const result = new Set<string>();
  for (const thread of threads) {
    let shielded = false;
    let hide = false;
    const seen = new Set<string>();
    for (let current: Thread | undefined = thread; current && !seen.has(current.id); current = current.parentThreadId ? byId.get(current.parentThreadId) : undefined) {
      seen.add(current.id);
      if (current.isPinned || keep.has(current.id)) shielded = true;
      if (hiddenSet.has(current.id)) hide = true;
    }
    if (hide && !shielded) result.add(thread.id);
  }
  // An open thread under a hidden one keeps its ancestors so it isn't orphaned.
  for (const id of keep) {
    const seen = new Set<string>();
    for (let current = byId.get(id); current && !seen.has(current.id); current = current.parentThreadId ? byId.get(current.parentThreadId) : undefined) {
      seen.add(current.id);
      result.delete(current.id);
    }
  }
  return result;
}
