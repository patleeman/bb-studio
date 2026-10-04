// Studio's projects: its own concept, not BB's. A project has a name, a lead
// and a page, and its members are threads from any BB project plus Studio
// items, either added by hand or, when it's connected to a BB project (a
// folder), every thread there. Until the server has projects_list, BB's own
// projects stand in, one for one.
import {
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import { useLive } from "./model";

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
