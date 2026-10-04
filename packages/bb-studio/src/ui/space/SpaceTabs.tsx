// Workbench tabs beside a Space's lead: one per thread or item you open, and
// "New in Space" from the New tab menu. Each is a thread panel tab, so BB owns
// the tab bar, closing, and restoring them.
import {
  ThreadChat,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { cn, GHOST_BUTTON, Icon } from "@bb-studio/kit/app";
import { useState } from "react";
import { useSpaceLead, useSpaceOf, useSpaceOverview } from "./data";
import { ItemEmbed } from "./ItemEmbed";
import { NewInSpacePicker, type CreatedItem } from "./NewInSpace";
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
