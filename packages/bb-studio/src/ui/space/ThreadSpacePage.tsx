// A Space's page beside any of its threads, not only the lead: a thread panel
// tab, opened once by itself the first time you open a thread of a Space that
// has a page, so every thread in a Space works with the page beside it.
import { useBbNavigate, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { useSpaceLead, useSpaceOf } from "./data";
import { PageEmbed } from "./PageEmbed";

export const SPACE_PAGE_ACTION = "space-page";

/** Thread panel: the page of the thread's Space. */
export function ThreadSpacePage({ threadId }: PluginThreadPanelProps) {
  const spaceOf = useSpaceOf();
  const lead = useSpaceLead(spaceOf(threadId));
  const pageId = lead.data?.pageId;
  if (pageId) return <PageEmbed pageId={pageId} />;
  return lead.loading ? null : <p className="p-4 text-sm text-muted-foreground">This thread isn't in a Space with a page.</p>;
}

// Threads we've opened the tab for, so closing it sticks for this session.
const OPENED_KEY = "bb-studio.space-page-opened";
function opened(): Set<string> {
  try { return new Set(JSON.parse(globalThis.sessionStorage?.getItem(OPENED_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

/**
 * Renders nothing; opens the Space page tab once per Space thread. Mounted
 * from the thread header (Handoff.tsx): that surface knows its thread and has
 * the side panel, where an app overlay has neither.
 */
export function OpenSpacePage({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  const spaceOf = useSpaceOf();
  const lead = useSpaceLead(spaceOf(threadId));
  const pageId = lead.data?.pageId ?? null;
  const leadId = lead.data?.leadThreadId ?? null;
  useEffect(() => {
    // The lead already has the page beside it in the Space's own view.
    if (!pageId || threadId === leadId) return;
    const seen = opened();
    if (seen.has(threadId)) return;
    if (navigate.openThreadPanel({ actionId: SPACE_PAGE_ACTION, title: "Space page" })) {
      seen.add(threadId);
      try { globalThis.sessionStorage?.setItem(OPENED_KEY, JSON.stringify([...seen])); } catch { /* private mode */ }
    }
  }, [threadId, pageId, leadId, navigate]);
  return null;
}
