import type { SidebarThread } from "../model/sidebar-thread.js";
import { NO_MACHINE_GROUP_KEY } from "../model/machine-thread-groups.js";
import type { OrganizationMode } from "../../shared/preferences.js";
import { createSpaceResolver, spaceSectionKey } from "./space-groups.js";

/** Keep a thread tree together, including children of explicitly pinned roots. */
function withDescendants(threads: readonly SidebarThread[], roots: Iterable<string>): Set<string> {
  const children = new Map<string, string[]>();
  for (const thread of threads) {
    if (!thread.parentThreadId) continue;
    const bucket = children.get(thread.parentThreadId) ?? [];
    bucket.push(thread.id);
    children.set(thread.parentThreadId, bucket);
  }
  const result = new Set(roots);
  const pending = [...result];
  for (let index = 0; index < pending.length; index += 1) {
    for (const id of children.get(pending[index]!) ?? []) {
      if (result.has(id)) continue;
      result.add(id);
      pending.push(id);
    }
  }
  return result;
}

/**
 * The threads to hide: the user's hidden threads and their children, so a
 * child is never orphaned. Pinned threads, and everything under them, always show.
 */
export function hiddenThreadIds(threads: readonly SidebarThread[], hidden: readonly string[]): Set<string> {
  const known = new Set(threads.map((thread) => thread.id));
  const result = withDescendants(threads, hidden.filter((id) => known.has(id)));
  const pinned = threads.filter((thread) => thread.isPinned).map((thread) => thread.id);
  for (const id of withDescendants(threads, pinned)) result.delete(id);
  return result;
}

export interface SectionKeyContext {
  mode: OrganizationMode;
  personalProjectId: string | null;
  spaceOf: Readonly<Record<string, string>>;
  spaceIds: ReadonlySet<string>;
  /** By space: where threads in no Space show. */
  defaultSpaceId?: string | null;
}

/**
 * The section key (as in `hiddenGroups`) each thread shows under in a mode.
 * Children follow their root, as the list nests them; By machine groups each
 * thread by its own host.
 */
export function createSectionKeyResolver(
  threads: readonly SidebarThread[],
  { mode, personalProjectId, spaceOf, spaceIds, defaultSpaceId = null }: SectionKeyContext,
): (thread: SidebarThread) => string {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const rootOf = (thread: SidebarThread) => {
    let root = thread;
    const seen = new Set([thread.id]);
    while (root.parentThreadId) {
      const parent = byId.get(root.parentThreadId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      root = parent;
    }
    return root;
  };
  if (mode === "space") {
    const spaceFor = createSpaceResolver(threads, spaceOf, spaceIds, defaultSpaceId);
    return (thread) => {
      const spaceId = spaceFor(thread);
      return spaceId === null ? "threads" : spaceSectionKey(spaceId);
    };
  }
  if (mode === "machine") return (thread) => `machine:${thread.host?.id ?? NO_MACHINE_GROUP_KEY}`;
  if (mode === "chronological") {
    return (thread) => {
      const sectionId = rootOf(thread).sectionId;
      return sectionId ? `section:${sectionId}` : "threads";
    };
  }
  return (thread) => {
    const projectId = rootOf(thread).projectId;
    return projectId === personalProjectId ? "threads" : `project:${projectId}`;
  };
}

export interface HiddenFilterInput {
  threads: readonly SidebarThread[];
  hiddenIds: ReadonlySet<string>;
  sectionKeyOf: (thread: SidebarThread) => string;
  /** Sections whose hidden threads the user revealed for now. */
  revealed: ReadonlySet<string>;
  /** Always shown, such as the open thread and Space leads. */
  keepIds: ReadonlySet<string>;
}

export interface HiddenFilterResult {
  /** Threads to list, in the input's order. */
  visible: SidebarThread[];
  /** Per section: how many threads it hides (or would, while revealed). */
  hidden: Map<string, number>;
}

/**
 * Drops hidden threads from each section unless the section is revealed.
 * A kept thread keeps its ancestors, so a child is never orphaned.
 */
export function filterHiddenThreads({ threads, hiddenIds, sectionKeyOf, revealed, keepIds }: HiddenFilterInput): HiddenFilterResult {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const kept = new Set<string>();
  const keepWithAncestors = (thread: SidebarThread) => {
    let current: SidebarThread | undefined = thread;
    while (current && !kept.has(current.id)) {
      kept.add(current.id);
      current = current.parentThreadId ? byId.get(current.parentThreadId) : undefined;
    }
  };
  const keys = new Map<string, string>();
  for (const thread of threads) {
    if (!hiddenIds.has(thread.id) || keepIds.has(thread.id)) keepWithAncestors(thread);
    else keys.set(thread.id, sectionKeyOf(thread));
  }
  const hidden = new Map<string, number>();
  const visible = threads.filter((thread) => {
    if (kept.has(thread.id)) return true;
    const key = keys.get(thread.id)!;
    if (!thread.isHidden) hidden.set(key, (hidden.get(key) ?? 0) + 1);
    return revealed.has(key);
  });
  return { visible, hidden };
}
