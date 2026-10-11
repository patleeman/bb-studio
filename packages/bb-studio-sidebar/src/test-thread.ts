import type { Thread } from "./model.js";

/** A sidebar thread for tests, idle and read unless `extra` says otherwise. */
export function thread(id: string, extra: Partial<Thread> = {}): Thread {
  return {
    id, projectId: "proj_a", title: id, titleFallback: null, displayTitle: id, parentThreadId: null,
    lifecycleOwnerThreadId: null, sourceThreadId: null, sectionId: null, originKind: null, originPluginId: null,
    providerId: "claude", status: "idle", runtimeStatus: "idle", queuedWork: "none", hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false, pinnedAt: null, pinSortKey: null,
    isArchived: false, archivedAt: null, href: `/projects/proj_a/threads/${id}`, isHidden: false, environment: null,
    host: null, createdAt: 0, updatedAt: 0, lastReadAt: null, latestAttentionAt: 0,
    ...extra,
  } as Thread;
}
