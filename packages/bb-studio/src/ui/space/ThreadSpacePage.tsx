// A Space's page beside any of its threads: a thread panel tab, opened once by
// itself the first time you open a thread of a Space that has a page. The
// lead gets the Space's status instead, since it's the Space's home.
import { useBbNavigate, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { useSpaceLead, useSpaceOf } from "./data";
import { PageEmbed } from "./ItemEmbed";
import { listenForOpens } from "./open-in-space";
import { openStatusTab } from "./tabs";

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
 * Renders nothing; opens the Space status beside the lead, and the Space page
 * beside other Space threads, once per thread per session. Mounted
 * from the thread header slot: that surface knows its thread and has
 * the side panel, where an app overlay has neither.
 */
export function OpenSpacePage({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  const spaceOf = useSpaceOf();
  const lead = useSpaceLead(spaceOf(threadId));
  const pageId = lead.data?.pageId ?? null;
  const leadId = lead.data?.leadThreadId ?? null;
  useEffect(() => {
    // The lead is the Space's home: its status goes beside it. Other threads get the page.
    const isLead = threadId === leadId;
    if (!isLead && !pageId) return;
    const seen = opened();
    if (seen.has(threadId)) return;
    if (isLead ? openStatusTab(navigate) : navigate.openThreadPanel({ actionId: SPACE_PAGE_ACTION, title: "Space page" })) {
      seen.add(threadId);
      try { globalThis.sessionStorage?.setItem(OPENED_KEY, JSON.stringify([...seen])); } catch { /* private mode */ }
    }
  }, [threadId, pageId, leadId, navigate]);
  // Opens what other plugins ask for beside this thread (see open-in-space.ts).
  useEffect(() => listenForOpens(threadId, navigate), [threadId, navigate]);
  return null;
}
