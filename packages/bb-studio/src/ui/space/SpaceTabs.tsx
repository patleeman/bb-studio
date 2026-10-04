// Workbench tabs beside a Space's lead: one per thread or item you open, and
// "New in Space" from the New tab menu. Each is a thread panel tab, so BB owns
// the tab bar, closing, and restoring them.
import {
  ThreadChat,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { cn, GHOST_BUTTON, Icon } from "@bb-studio/kit/app";
import { useCallback, useEffect, useState } from "react";
import type { rpcContract } from "../../contract";
import { TABS_CHANNEL } from "../../ids";
import { useSpaceLead, useSpaceOf, useSpaceOverview } from "./data";
import { ItemEmbed } from "./ItemEmbed";
import { NewInSpaceMenu, NewInSpacePicker, type CreatedItem } from "./NewInSpace";
import { ItemRow } from "./Overview";
import { stateOf } from "./status";
import { StartThreadDialog } from "./SpaceView";
import { SPACE_ITEM_ACTION, draftItem, draftParams, itemParams, openItemTab, openThreadTab, saveDraftItem, threadParams } from "./tabs";

function NotInSpace() {
  return <p className="p-4 text-sm text-muted-foreground">This thread isn't in a Space.</p>;
}

/** A Space thread beside the lead, or a list to pick one from. */
export function SpaceThreadTab({ threadId, params }: PluginThreadPanelProps) {
  const opened = threadParams(params);
  if (opened) return <ThreadChat key={opened.threadId} threadId={opened.threadId} variant="full" layout="contained" permissionPolicy="inherit" className="h-full min-h-0" />;
  return <ThreadPicker threadId={threadId} />;
}

function ThreadPicker({ threadId }: { threadId: string }) {
  const spaceId = useSpaceOf()(threadId);
  const lead = useSpaceLead(spaceId);
  const overview = useSpaceOverview(spaceId);
  const { threads: sidebar } = useSidebarThreads();
  const navigate = useBbNavigate();
  const [starting, setStarting] = useState(false);
  if (!spaceId) return <NotInSpace />;
  const live = new Map(sidebar.map((thread) => [thread.id, thread]));
  const rows = (overview.data?.threads ?? []).filter((thread) => !thread.isLead && thread.id !== threadId);
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-8">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-lg font-semibold">Open a thread</h1>
        <button type="button" onClick={() => setStarting(true)} className={GHOST_BUTTON}><Icon name="Plus" className="size-4" />New thread</button>
      </div>
      <div className="mt-4 space-y-px">
        {rows.map((thread) => {
          const state = stateOf(thread, live.get(thread.id));
          const title = live.get(thread.id)?.displayTitle ?? thread.title;
          return (
            <button key={thread.id} type="button" onClick={() => openThreadTab(navigate, { id: thread.id, title })} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-state-hover">
              <span className="min-w-0 flex-1 truncate">{title}</span>
              <span className={cn("shrink-0 text-xs", state.tone)}>{state.label}</span>
            </button>
          );
        })}
        {overview.data && !rows.length ? <p className="px-3 py-2 text-sm text-muted-foreground">No other threads in this Space yet.</p> : null}
      </div>
      {starting && lead.data ? (
        <StartThreadDialog
          spaceId={spaceId}
          name={lead.data.name}
          defaultProjectId={lead.data.defaultProjectId}
          onStarted={(id) => openThreadTab(navigate, { id, title: "New thread" })}
          onClose={() => setStarting(false)}
        />
      ) : null}
    </div>
  );
}

/** A Studio item beside the lead; "New in Space" until something is made. */
export function SpaceItemTab({ threadId, params }: PluginThreadPanelProps) {
  const navigate = useBbNavigate();
  const item = itemParams(params);
  const draft = draftParams(params);
  const [made, setMade] = useState(() => (draft ? draftItem(draft.draft) : null));
  const spaceId = useSpaceOf()(threadId);
  const lead = useSpaceLead(spaceId);
  const shown = item ?? made;
  if (shown) return <ItemEmbed key={shown.path} path={shown.path} title={shown.title} />;
  if (!spaceId) return <NotInSpace />;
  const onCreated = (created: CreatedItem) => {
    const next = { path: created.href, title: created.title };
    if (!draft) { openItemTab(navigate, created); return; }
    // This tab becomes the new item: remember it, and retitle the tab.
    saveDraftItem(draft.draft, next);
    setMade(next);
    navigate.openThreadPanel({ actionId: SPACE_ITEM_ACTION, title: created.title, params: { draft: draft.draft } });
  };
  return <NewInSpacePicker spaceId={spaceId} spaceName={lead.data?.name ?? "this Space"} onCreated={onCreated} />;
}

/** The Space's Studio items that aren't open; picking one opens it beside the lead, where it lists as open. */
export function SpaceItemsTab({ threadId }: PluginThreadPanelProps) {
  const spaceId = useSpaceOf()(threadId);
  const lead = useSpaceLead(spaceId);
  const overview = useSpaceOverview(spaceId);
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState<ReadonlySet<string> | null>(null);
  const [query, setQuery] = useState("");
  const refresh = useCallback(() => {
    rpc.call("tabs", null).then(({ tabs }) => setOpen(new Set(tabs.map((tab) => `${tab.pluginId}:${tab.id}`))), () => setOpen(new Set()));
  }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime(TABS_CHANNEL, refresh);
  if (!spaceId) return <NotInSpace />;
  const name = lead.data?.name ?? "this Space";
  const needle = query.trim().toLowerCase();
  const closed = (overview.data?.items ?? []).filter((item) => !open?.has(item.ref));
  const rows = needle ? closed.filter((item) => item.title.toLowerCase().includes(needle)) : closed;
  const loading = !overview.data || !open;
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-8">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-lg font-semibold">Studio in {name}</h1>
        <NewInSpaceMenu spaceId={spaceId} onCreated={(item) => openItemTab(navigate, item)} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Items in this Space that aren't open. Open one to keep it in the sidebar.</p>
      {closed.length > 6 ? (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by title"
          aria-label="Filter items"
          className="mt-4 h-8 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : null}
      <div className="-mx-2 mt-4">
        {rows.map((item) => <ItemRow key={item.ref} item={item} onOpen={() => openItemTab(navigate, item)} />)}
      </div>
      {loading ? <p role="status" className="text-sm text-muted-foreground">Loading…</p>
        : !closed.length ? <p className="text-sm text-muted-foreground">{overview.data?.items.length ? `Everything in ${name} is open.` : `No pages, drawings or tables yet. Anything you make here stays in ${name}.`}</p>
          : !rows.length ? <p className="text-sm text-muted-foreground">Nothing matches.</p> : null}
    </div>
  );
}
