// Studio's projects: its own concept, not BB's. A project has a name, a lead
// and a page, and its members are threads from any BB project plus Studio
// items, either added by hand or, when it's connected to a BB project (a
// folder), every thread there. Until the server has projects_list, BB's own
// projects stand in, one for one.
import {
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useCallback, useMemo } from "react";
import { useCall, useLive } from "./model";

export interface WorkProject {
  id: string;
  name: string;
  icon?: string | null;
  role?: "chief-of-staff" | "project";
  /** The BB project (a folder) new threads start in; null starts them in Personal. */
  bbProjectId: string | null;
  archivedAt?: number | null;
}

export interface MemberItem { ref: string; projectId: string; title: string; kind: string; href: string; icon: string | null }

interface Membership { threads: Record<string, string>; items: MemberItem[] }

export interface Work {
  /** Ordered; without the Chief of Staff and archived projects. */
  projects: WorkProject[];
  chief: WorkProject | null;
  /** The Studio project a thread belongs to, or null for a one-off. */
  projectOf: (thread: Pick<PluginSidebarThread, "id" | "projectId">) => string | null;
  items: MemberItem[];
  /** False while the server predates Studio projects: moving things between projects is off. */
  canOrganize: boolean;
  /** Every project id in server order, including the Chief of Staff and archived ones; reorder neighbours come from here. */
  order: string[];
  refresh: () => void;
}

export function useWork(): Work {
  const { projects: bbProjects } = useSidebarThreads();
  const list = useLive<{ projects: WorkProject[] }>("projects_list", {}, { pollMs: 0 });
  const membership = useLive<Membership>("project_membership", {}, { pollMs: 0 });
  const native = list.data !== undefined && list.data !== null && !list.error;

  return useMemo<Work>(() => {
    const refresh = () => { list.refresh(); membership.refresh(); };
    if (native) {
      const all = list.data!.projects.filter((project) => !project.archivedAt);
      const threads = membership.data?.threads ?? {};
      return {
        projects: all.filter((project) => project.role !== "chief-of-staff"),
        chief: all.find((project) => project.role === "chief-of-staff") ?? null,
        projectOf: (thread) => threads[thread.id] ?? null,
        items: membership.data?.items ?? [],
        canOrganize: true,
        order: [...list.data!.projects].sort((a, b) => ((a as { position?: number }).position ?? 0) - ((b as { position?: number }).position ?? 0)).map((project) => project.id),
        refresh,
      };
    }
    const personal = bbProjects.find((project) => project.isPersonal);
    return {
      projects: bbProjects.filter((project) => !project.isPersonal).map((project) => ({ id: project.id, name: project.name, bbProjectId: project.id, role: "project" as const })),
      chief: personal ? { id: personal.id, name: "Chief of Staff", bbProjectId: personal.id, role: "chief-of-staff" } : null,
      projectOf: (thread) => (thread.projectId === personal?.id ? null : thread.projectId),
      items: [],
      canOrganize: false,
      order: [],
      refresh,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, list.data, membership.data, bbProjects]);
}

export type ThreadSort = { by: "updated" | "created" | "alpha"; desc: boolean };

export function sortThreads(threads: readonly PluginSidebarThread[], sort: ThreadSort): PluginSidebarThread[] {
  const key = (thread: PluginSidebarThread) => sort.by === "alpha" ? 0 : sort.by === "created" ? (thread as { createdAt?: number }).createdAt ?? thread.updatedAt : thread.updatedAt;
  const sign = sort.desc ? -1 : 1;
  return [...threads].sort((a, b) =>
    sort.by === "alpha"
      ? sign * a.displayTitle.localeCompare(b.displayTitle, undefined, { sensitivity: "base" })
      : sign * (key(a) - key(b)));
}

/** Rows in order: each top-level thread, then its sub-threads, for range selection and rendering. */
export function nest(threads: readonly PluginSidebarThread[]): { thread: PluginSidebarThread; depth: number }[] {
  const ids = new Set(threads.map((thread) => thread.id));
  const children = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) if (thread.parentThreadId && ids.has(thread.parentThreadId)) children.set(thread.parentThreadId, [...(children.get(thread.parentThreadId) ?? []), thread]);
  const rows: { thread: PluginSidebarThread; depth: number }[] = [];
  const walk = (thread: PluginSidebarThread, depth: number) => {
    rows.push({ thread, depth });
    for (const child of children.get(thread.id) ?? []) walk(child, depth + 1);
  };
  for (const thread of threads) if (!thread.parentThreadId || !ids.has(thread.parentThreadId)) walk(thread, 0);
  return rows;
}

/** Shift-click selection: toggle one, or everything between the anchor and here. */
export function extendSelection(order: readonly string[], selected: ReadonlySet<string>, anchor: string | null, id: string, range: boolean): Set<string> {
  const next = new Set(selected);
  if (range && anchor && order.includes(anchor)) {
    const [from, to] = [order.indexOf(anchor), order.indexOf(id)].sort((a, b) => a - b);
    for (const between of order.slice(from, to + 1)) next.add(between);
    return next;
  }
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** The ids to move with a thread: it and its sub-threads, so a parent doesn't leave its children behind. */
export function withDescendants(ids: readonly string[], threads: readonly Pick<PluginSidebarThread, "id" | "parentThreadId">[]): string[] {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const thread of threads) if (thread.parentThreadId && out.has(thread.parentThreadId) && !out.has(thread.id)) { out.add(thread.id); grew = true; }
  }
  return [...out];
}

/** Neighbours for putting `dragged` just before `before`, from the full server order. */
export function reorderNeighbours(order: readonly string[], dragged: string, before: string): { previousProjectId: string | null; nextProjectId: string } {
  const rest = order.filter((id) => id !== dragged);
  const index = rest.indexOf(before);
  return { previousProjectId: index > 0 ? rest[index - 1]! : null, nextProjectId: before };
}

/** Moving threads between projects, from any surface. Null moves them out of every project. */
export function useMoveThreads() {
  const call = useCall();
  const work = useWork();
  const { threads } = useSidebarThreads();
  const move = useCallback(async (threadIds: readonly string[], projectId: string | null) => {
    if (!threadIds.length || !work.canOrganize) return;
    const refs = withDescendants(threadIds, threads).map((id) => `thread:${id}`);
    try {
      await (projectId ? call("project_link", { projectId, refs }) : call("project_unlink", { refs }));
    } finally {
      work.refresh();
    }
  }, [call, work, threads]);
  const targets = useCallback((thread: Pick<PluginSidebarThread, "id" | "projectId"> | null) => {
    if (!work.canOrganize) return null;
    const current = thread ? work.projectOf(thread) : undefined;
    return [
      ...work.projects.map((project) => ({ id: project.id as string | null, name: project.name, current: current === project.id })),
      { id: null, name: "No project", current: current === null },
    ];
  }, [work]);
  return { move, targets, work };
}
