import type { SidebarThread } from "../model/sidebar-thread.js";
import { NO_MACHINE_GROUP_KEY } from "../model/machine-thread-groups.js";
import type { AutomatedThreadsMode, OrganizationMode } from "../../shared/preferences.js";
import { createSpaceResolver, spaceSectionKey } from "./space-groups.js";

/** What attaches a thread to a schedule or a bot; picks the row's mark. */
export type AutomatedKind = "automation" | "bot";

/** The `automatedThreads` entry that applies to sections without their own. */
export const ALL_SECTIONS_KEY = "*";
export const DEFAULT_AUTOMATED_MODE: AutomatedThreadsMode = "updates";

/**
 * Threads attached to a bot or an automation, from the public RPCs, or
 * spawned by those plugins. A thread with both shows the automation's mark.
 */
export function automatedThreadKinds(
  threads: readonly SidebarThread[],
  botIds: ReadonlySet<string>,
  automationIds: ReadonlySet<string>,
): Map<string, AutomatedKind> {
  const kinds = new Map<string, AutomatedKind>();
  for (const thread of threads) {
    if (automationIds.has(thread.id) || thread.originPluginId === "automations") kinds.set(thread.id, "automation");
    else if (botIds.has(thread.id) || thread.originPluginId === "bot-teams") kinds.set(thread.id, "bot");
  }
  return kinds;
}

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
 * The threads a section's automated filter applies to: marked threads and
 * their children. Pinned threads, and everything under them, always show.
 */
export function automatedThreadIds(threads: readonly SidebarThread[], kinds: ReadonlyMap<string, AutomatedKind>): Set<string> {
  const result = withDescendants(threads, kinds.keys());
  const pinned = threads.filter((thread) => thread.isPinned).map((thread) => thread.id);
  for (const id of withDescendants(threads, pinned)) result.delete(id);
  return result;
}

const RUNNING_STATUSES = new Set(["starting", "active", "stopping"]);

/** Needs input, an unread result, a failed queued message, or running now. */
export function hasAutomatedUpdate(thread: SidebarThread): boolean {
  return thread.hasPendingInteraction || thread.queuedWork === "failed" ||
    RUNNING_STATUSES.has(thread.status) ||
    (thread.isUnread && (thread.status === "idle" || thread.status === "error"));
}

export function automatedModeFor(
  preferences: Readonly<Record<string, AutomatedThreadsMode>>,
  sectionKey: string,
): AutomatedThreadsMode {
  return preferences[sectionKey] ?? preferences[ALL_SECTIONS_KEY] ?? DEFAULT_AUTOMATED_MODE;
}

export interface SectionKeyContext {
  mode: OrganizationMode;
  personalProjectId: string | null;
  spaceOf: Readonly<Record<string, string>>;
  spaceIds: ReadonlySet<string>;
}

/**
 * The section key (as in `hiddenGroups`) each thread shows under in a mode.
 * Children follow their root, as the list nests them; By machine groups each
 * thread by its own host.
 */
export function createSectionKeyResolver(
  threads: readonly SidebarThread[],
  { mode, personalProjectId, spaceOf, spaceIds }: SectionKeyContext,
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
    const spaceFor = createSpaceResolver(threads, spaceOf, spaceIds);
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

export interface AutomatedFilterInput {
  threads: readonly SidebarThread[];
  automatedIds: ReadonlySet<string>;
  sectionKeyOf: (thread: SidebarThread) => string;
  modeFor: (sectionKey: string) => AutomatedThreadsMode;
  /** Sections whose hidden threads the user revealed for now. */
  revealed: ReadonlySet<string>;
  /** Always shown, such as the open thread and Space leads. */
  keepIds: ReadonlySet<string>;
}

export interface AutomatedFilterResult {
  /** Threads to list, in the input's order. */
  visible: SidebarThread[];
  /** Per section: how many automated threads its filter hides (or would, while revealed). */
  hidden: Map<string, number>;
}

/**
 * Applies each section's Automated threads choice. "updates" keeps threads
 * with an update and their ancestors, so a child is never orphaned.
 */
export function filterAutomatedThreads({ threads, automatedIds, sectionKeyOf, modeFor, revealed, keepIds }: AutomatedFilterInput): AutomatedFilterResult {
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
    if (!automatedIds.has(thread.id)) {
      keepWithAncestors(thread);
      continue;
    }
    const key = sectionKeyOf(thread);
    keys.set(thread.id, key);
    const mode = modeFor(key);
    if (mode === "all" || keepIds.has(thread.id) || (mode === "updates" && hasAutomatedUpdate(thread))) keepWithAncestors(thread);
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
