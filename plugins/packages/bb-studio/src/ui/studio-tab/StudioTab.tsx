import { requestGeneration } from "../../kit/ui/request-generation";
// The Studio tab in a thread's workbench: one panel action for every kind
// that opens beside the conversation. It opens on Studio's library, the same
// one as the Studio app's new tab, with this thread's items first; and an
// item opens in place in its kind's editor, with a way back; an add-on's item
// opens its page in BB's main area. Cards open it with `{ kind, id }`; see
// ./model.ts for params and kinds.
import { hasGlobalWorkbench } from "../../kit/app/host-sdk";
import { sharedItemView } from "../global-workbench";
import { ICON_BUTTON, Icon, OUTLINE_BUTTON, PRIMARY_BUTTON, cn, openAppPath } from "../../kit/app/index";
import { errorMessage } from "../../kit/format";
import { useRealtime, useRpc, useSdk, type JsonValue } from "@get-bb/plugin-sdk/app";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { toast } from "sonner";
import type { ProviderView, rpcContract } from "../../contract";
import type { rpcContract as pagesContract } from "../../pages/contract";
import { REALTIME_CHANNEL as ARTIFACTS_CHANNEL } from "../../artifacts/shared";
import { REALTIME_CHANNEL as MINIS_CHANNEL } from "../../minis/shared";
import { REALTIME_CHANNEL as DESIGN_CHANNEL } from "../../design/shared";
import { REALTIME_CHANNEL as DRAW_CHANNEL } from "../../draw/shared";
import { REALTIME_CHANNEL as PAGES_CHANNEL } from "../../pages/constants";
import { RECORDING_CHANGED } from "../../talk/shared/format";
import { appliedKinds } from "../kinds-snapshot";
import { runCreateEntry, startsGroup, useCreateEntries, type CreateEntry } from "../create-menu";
import { collectionKinds, enabledKinds, itemOpening, tabTarget, type TabKind, type TabKindInfo, type TabTarget } from "./model";
import { StudioLibrary, type LibraryThreadHost } from "../StudioPanel";
import { StudioContainerProvider, useStudioOpen } from "../studio-open";
import { applyScroll, elementPath, loadView, onViewForgotten, sameTarget, saveView, viewKey, type TabScroll } from "./view-state";

const PageView = lazy(() => import("../../pages/ui/PagePanel").then((module) => ({ default: module.PageTab })));
const DrawingView = lazy(() => import("../../draw/ui/drawing-editor").then((module) => ({ default: module.DrawingEditor })));
const DesignView = lazy(() => import("../../design/ui/design-tab").then((module) => ({ default: module.TabCanvas })));
const MiniView = lazy(() => import("../../minis/ui/mini-view").then((module) => ({ default: module.TabMini })));
const ArtifactView = lazy(() => import("../../artifacts/ui/artifact-viewer").then((module) => ({ default: module.ArtifactViewer })));
const RecordingView = lazy(() => import("../../talk/ui/recordings-panel").then((module) => ({ default: module.RecordingDetail })));
const SavePicker = lazy(() => import("../../artifacts/ui/save-picker").then((module) => ({ default: module.SavePicker })));

const BACK = "Library";

/** One item in its kind's in-thread view. */
export function ItemView({ kind, id, threadId, onBack }: { kind: TabKind; id: string; threadId: string; onBack(): void }) {
  const props = { backLabel: BACK, onBack };
  // Where items also open in BB's main view, the tab shows that same page, so its header is the same one.
  const shared = hasGlobalWorkbench ? sharedItemView(kind, id) : null;
  if (shared) return shared;
  return (
    <Suspense fallback={null}>
      {kind === "page" ? <PageView key={id} pageId={id} {...props} />
        : kind === "drawing" ? <DrawingView key={id} drawingId={id} threadId={threadId} {...props} />
        : kind === "design" ? <DesignView key={id} designId={id} {...props} />
        : kind === "mini" ? <MiniView key={id} miniId={id} threadId={threadId} {...props} />
        : kind === "recording" || kind === "dictation" ? <RecordingView key={id} id={id} onBack={onBack} />
        : <ArtifactView key={id} artifactId={id} threadId={threadId} {...props} />}
    </Suspense>
  );
}

export function StudioTab({ threadId, params }: { threadId: string; params: JsonValue | null }) {
  const enabled = useMemo(() => enabledKinds(appliedKinds()?.off ?? new Set()), []);
  const asked = useMemo(() => tabTarget(params, enabled), [params, enabled]);
  const key = viewKey(threadId, params);
  // BB unmounts this tab when another one is selected, and on a reload; it
  // comes back where it was left (./view-state.ts).
  const [restored] = useState(() => loadView(key, enabled));
  const [target, setTarget] = useState<TabTarget>(restored?.target ?? asked);
  // The library keeps its own query now; the saved view's kind filter stays empty.
  const filter = null;
  // BB keeps this tab mounted when a card opens it on another item, so a new
  // target replaces the one on screen.
  const [openedWith, setOpenedWith] = useState(asked);
  if (JSON.stringify(openedWith) !== JSON.stringify(asked)) {
    setOpenedWith(asked);
    setTarget(asked);
  }
  // A card opening this instance again shows its item, wherever the tab was.
  useEffect(() => onViewForgotten(key, () => setTarget(asked)), [key, asked]);
  const back = useCallback(() => setTarget({ view: "list" }), []);
  const root = useViewMemory(key, target, filter, restored?.scroll ?? null);

  // Links in here open as tabs in this thread's workbench (../studio-open.tsx).
  return (
    <StudioContainerProvider value={{ kind: "thread", threadId }}>
      <div ref={root.ref} className="contents" onScrollCapture={root.onScroll} onWheelCapture={root.onUser} onPointerDownCapture={root.onUser} onKeyDownCapture={root.onUser} onTouchStartCapture={root.onUser}>
        <TabView threadId={threadId} target={target} enabled={enabled} onTarget={setTarget} onBack={back} />
      </div>
    </StudioContainerProvider>
  );
}

function TabView({ threadId, target, enabled, onTarget, onBack: back }: {
  threadId: string;
  target: TabTarget;
  enabled: readonly TabKindInfo[];
  onTarget(target: TabTarget): void;
  onBack(): void;
}) {
  if (target.view === "item") return <ItemView kind={target.kind} id={target.id} threadId={threadId} onBack={back} />;
  if (target.view === "save") {
    return (
      <div className="studio-root flex h-full flex-col bg-background text-foreground">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <button type="button" aria-label={`Back to ${BACK}`} title={`Back to ${BACK}`} className={ICON_BUTTON} onClick={back}>
            <Icon name="ArrowLeft" className="size-4" />
          </button>
          <span className="text-sm font-medium">Save files</span>
        </header>
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <SavePicker threadId={threadId} params={target.seq === null ? null : { seq: target.seq }} />
          </Suspense>
        </div>
      </div>
    );
  }
  return (
    <Collection
      threadId={threadId}
      enabled={enabled}
      onOpen={(kind, id) => onTarget({ view: "item", kind, id })}
      onSave={() => onTarget({ view: "save", seq: null })}
    />
  );
}

/** How long a restored scroll waits for its view's content to load. */
const RESTORE_MS = 5000;
/** How often scrolling saves, at most. */
const SAVE_MS = 250;

/**
 * Saves the tab's view whenever it changes and its scroll as it scrolls, and
 * scrolls a restored view back once its content is tall enough. Spread its
 * handlers on a wrapper around the view.
 */
function useViewMemory(key: string, target: TabTarget, filter: string | null, restoredScroll: TabScroll | null) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = useRef<TabScroll | null>(restoredScroll);
  const pending = useRef<TabScroll | null>(restoredScroll);
  const shown = useRef(target);
  const latest = useRef({ key, target, filter });
  latest.current = { key, target, filter };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const { key, target, filter } = latest.current;
    saveView(key, { target, filter, scroll: scroll.current });
  }, []);

  // A new view starts at the top, and is saved at once.
  useEffect(() => {
    if (!sameTarget(shown.current, target)) {
      shown.current = target;
      scroll.current = null;
      pending.current = null;
    }
    save();
  }, [key, target, filter, save]);
  // Leaving (a tab switch, a reload) keeps the last scroll.
  useEffect(() => () => { if (timer.current) save(); }, [save]);

  // Scroll a restored view back, frame by frame, until its content is there.
  useLayoutEffect(() => {
    const goal = pending.current;
    const element = ref.current;
    if (!goal || !element) return;
    const until = Date.now() + RESTORE_MS;
    let frame = 0;
    const step = () => {
      if (pending.current !== goal) return;
      if (applyScroll(element, goal) || Date.now() > until) { pending.current = null; return; }
      frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
    // Only a restored view, on mount; a view opened later starts at the top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = useCallback((event: SyntheticEvent) => {
    // While restoring, a view loading in isn't the user's scroll.
    if (pending.current || !ref.current || !(event.target instanceof Element)) return;
    const path = elementPath(ref.current, event.target);
    if (!path) return;
    scroll.current = { path, top: Math.max(0, Math.round(event.target.scrollTop)) };
    if (!timer.current) timer.current = setTimeout(save, SAVE_MS);
  }, [save]);
  // The user taking over stops a restore.
  const onUser = useCallback(() => { pending.current = null; }, []);
  return { ref, onScroll, onUser };
}

/** Refetch when any shown kind changes. A fixed hook per kind, so the count never changes. */
function useKindChanges(onChange: () => void) {
  useRealtime(PAGES_CHANNEL, onChange);
  useRealtime(DRAW_CHANNEL, onChange);
  useRealtime(DESIGN_CHANNEL, onChange);
  // Mini apps also stream state and records here; only item changes matter.
  useRealtime(MINIS_CHANNEL, (payload) => { if ((payload as { type?: string } | null)?.type === "changed") onChange(); });
  useRealtime(ARTIFACTS_CHANNEL, onChange);
  useRealtime(RECORDING_CHANGED, onChange);
}

/**
 * The workbench's collection is Studio's library (../StudioPanel.tsx), the
 * same component as the Studio app's new tab, with this thread's items first.
 * Here it adds which items are this thread's, opening in place, and New
 * making items for this thread.
 */
function Collection({
  threadId,
  enabled,
  onOpen,
  onSave,
}: {
  threadId: string;
  enabled: readonly TabKindInfo[];
  onOpen(kind: TabKind, id: string): void;
  onSave(): void;
}) {
  const studioOpen = useStudioOpen();
  const rpc = useRpc<typeof rpcContract>();
  const pages = useRpc<typeof pagesContract>();
  const sdk = useSdk();
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [linked, setLinked] = useState<ReadonlySet<string>>(new Set());
  const [thread, setThread] = useState<{ projectId: string | null; status: string } | null>(null);
  const [requests] = useState(requestGeneration);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useKindChanges(useCallback(() => setRefreshKey((current) => current + 1), []));

  useEffect(() => {
    let live = true;
    sdk.threads.get({ threadId }).then(
      (found) => live && setThread({ projectId: found.projectId ?? null, status: found.status }),
      () => live && setThread({ projectId: null, status: "idle" }),
    );
    return () => {
      live = false;
    };
  }, [sdk, threadId]);

  // This thread's items: linked to it, and a Pages chat's page.
  useEffect(() => {
    const current = requests.begin();
    setLoadError(null);
    Promise.all([
      rpc.call("overview", null).then((result) => result.providers),
      rpc.call("threadItems", { threadId }).then(({ threads }) => threads.map((each) => `${each.ref.pluginId}:${each.ref.id}`)),
      pages.call("pages.chatPage", { threadId }).then((result) => (result.page ? [`pages:${result.page.id}`] : [])),
    ]).then(
      ([found, links, chatPage]) => {
        if (!current()) return;
        setProviders(found);
        setLinked(new Set([...links, ...chatPage]));
      },
      (cause: unknown) => { if (current()) setLoadError(errorMessage(cause)); },
    );
    return () => {
      requests.invalidate();
    };
  }, [rpc, pages, threadId, refreshKey, requests]);

  const projectId = thread?.projectId ?? null;
  const kinds = useMemo(() => collectionKinds(enabled, providers), [enabled, providers]);
  const creatable = useCreateEntries(rpc, providers, refreshKey);
  const open = useCallback((item: { pluginId: string; kind: string; id: string; href: string }) => {
    const opening = itemOpening(item, kinds);
    if (opening?.open === "tab") onOpen(opening.kind, opening.id);
    // Add-on kinds have no in-thread view: their page opens where Studio opens it.
    else studioOpen({ href: item.href });
  }, [kinds, onOpen, studioOpen]);

  const linkCreated = async (association: Parameters<typeof rpc.call<"linkItemThread">>[1]) => {
    try {
      await rpc.call("linkItemThread", association);
      setRefreshKey((key) => key + 1);
    } catch (cause) {
      toast.error(`Item created, but couldn't link it to this thread: ${errorMessage(cause)}`, {
        duration: Infinity,
        action: { label: "Retry link", onClick: () => { void linkCreated(association); } },
      });
    }
  };

  // Made for this thread: linked to it, then opened in place, or on its page for a kind the tab can't show.
  const createKind = async (entry: Extract<CreateEntry, { type: "kind" }>) => {
    setCreating(true);
    try {
      const { item } = await rpc.call("create", { pluginId: entry.pluginId, kind: entry.kind.id, projectId });
      const now = Date.now();
      await linkCreated({ thread: { threadId, ref: { pluginId: entry.pluginId, id: item.id }, role: "created", state: thread?.status ?? "idle", createdAt: now, updatedAt: now, metadata: {} } });
      const opening = itemOpening({ pluginId: entry.pluginId, kind: entry.kind.id, id: item.id, href: item.href }, kinds);
      if (opening?.open === "tab") onOpen(opening.kind, opening.id);
      else openAppPath(item.href);
    } catch (cause) {
      toast.error(`Couldn't create a ${entry.label.toLowerCase()}: ${errorMessage(cause)}`);
    } finally {
      setCreating(false);
    }
  };
  const create = (entry: CreateEntry) => {
    setMenu(false);
    // A whiteboard page or a template's item opens beside this thread too.
    void runCreateEntry(entry, { rpc, projectId, createKind, open: (href) => studioOpen({ href }) });
  };

  const headerActions = (
    <>
      {enabled.some((each) => each.kind === "artifact") ? (
        <button type="button" className={ICON_BUTTON} title="Save a reply's files" aria-label="Save a reply's files" onClick={onSave}>
          <Icon name="studio/artifact-save" fallback="Download" className="size-4" />
        </button>
      ) : null}
      {creatable.length ? (
        <div className="relative">
          <button type="button" className={PRIMARY_BUTTON} aria-haspopup="menu" aria-expanded={menu} disabled={creating || !thread} onClick={() => setMenu((open) => !open)}>
            <Icon name="Plus" />
            New
          </button>
          {menu ? (
            <ul role="menu" className="absolute top-full right-0 z-30 mt-1 min-w-40 rounded-md border border-border bg-background p-1 shadow-md">
              {creatable.map((entry, index) => (
                <li key={entry.key} className={startsGroup(creatable, index) ? "mt-1 border-t border-border pt-1" : undefined}>
                  <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-state-hover" onClick={() => create(entry)}>
                    <Icon name={entry.icon} fallback="GridView" className="size-4 text-muted-foreground" />
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );

  const host = useMemo<LibraryThreadHost>(() => ({
    threadId,
    linked,
    projectId,
    onOpen: open,
    createItems: creatable.map((entry, index) => ({ id: entry.key, label: entry.label, icon: entry.icon, separated: startsGroup(creatable, index), onSelect: () => create(entry) })),
    headerActions,
    // headerActions and create read the latest state each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [threadId, linked, projectId, open, creatable, creating, thread, enabled, menu]);

  return (
    <div className="studio-root flex h-full flex-col overflow-auto bg-background text-foreground">
      {loadError ? (
        <div role="alert" className="flex flex-col items-start gap-2 px-4 py-3 text-sm">
          <p className="flex items-start gap-2 text-muted-foreground">
            <Icon name="AlertCircle" className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span><span className="text-foreground">Couldn't load this thread's items.</span> {loadError.replace(/[.\s]+$/, "")}.</span>
          </p>
          <button type="button" className={cn(OUTLINE_BUTTON, "ml-6")} onClick={() => setRefreshKey((key) => key + 1)}>
            <Icon name="RotateCcw" />
            Retry loading items
          </button>
        </div>
      ) : null}
      <StudioLibrary thread={host} />
    </div>
  );
}

export default StudioTab;
