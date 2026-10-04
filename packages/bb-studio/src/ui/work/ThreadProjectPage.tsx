// The project's page beside any of its threads, not only the lead: a
// workbench tab in the thread view, opened once by itself the first time you
// open a thread of a project that has a page, so every thread in a project
// works with the page beside it.
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useBbContext,
  useBbNavigate,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { PageEmbed, useProject } from "./ProjectPanel";
import { useWork } from "./projects";

export const PROJECT_PAGE_ACTION = "project-page";

function useThreadProject(threadId: string | null): string | null {
  const { threads } = useSidebarThreads();
  const { projectOf } = useWork();
  const thread = threadId ? threads.find((entry) => entry.id === threadId) : undefined;
  return thread ? projectOf(thread) : null;
}

/** Workbench tab: the page of the thread's project. */
export function ThreadProjectPage({ threadId }: PluginThreadPanelProps) {
  const project = useProject(useThreadProject(threadId));
  const pageId = project.data?.pageId;
  if (pageId) return <PageEmbed pageId={pageId} />;
  return project.loading ? null : <p className="p-4 text-sm text-muted-foreground">This thread's project has no page yet. Start the project's lead from Projects to make one.</p>;
}

// Threads we've opened the tab for, so closing it sticks for this session.
const OPENED_KEY = "bb-studio.work.project-page-opened";
function opened(): Set<string> {
  try { return new Set(JSON.parse(globalThis.sessionStorage?.getItem(OPENED_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

/** Renders nothing; opens the Project page tab once per project thread. */
export function OpenProjectPage() {
  const { threadId } = useBbContext();
  const navigate = useBbNavigate();
  const project = useProject(useThreadProject(threadId));
  const pageId = project.data?.pageId ?? null;
  const leadId = project.data?.leadThreadId ?? null;
  useEffect(() => {
    // The lead already has the page beside it on the project's own view.
    if (!threadId || !pageId || threadId === leadId) return;
    const seen = opened();
    if (seen.has(threadId)) return;
    if (navigate.openThreadPanel({ actionId: PROJECT_PAGE_ACTION, title: "Project page" })) {
      seen.add(threadId);
      try { globalThis.sessionStorage?.setItem(OPENED_KEY, JSON.stringify([...seen])); } catch { /* private mode */ }
    }
  }, [threadId, pageId, leadId, navigate]);
  return null;
}
