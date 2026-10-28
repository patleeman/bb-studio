import { requestGeneration } from "../../kit/ui/request-generation";
// The Studio tab in a thread's workbench: one panel action for every kind
// that opens beside the conversation. It opens on the thread's collection
// (this thread's items, then recent ones; search and a kind filter), and an
// item opens in place in its kind's editor, with a way back; an add-on's item
// opens its page in BB's main area. Cards open it with `{ kind, id }`; see
// ./model.ts for params and kinds.
import { ICON_BUTTON, Icon, ItemTile, OUTLINE_BUTTON, PRIMARY_BUTTON, THUMBNAIL, cn, openAppPath, studioItemProps } from "../../kit/app/index";
import { errorMessage, relativeTime, untitled } from "../../kit/format";
import { useRealtime, useRpc, useSdk, type JsonValue } from "@get-bb/plugin-sdk/app";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { z } from "zod";
import type { ProviderView, rpcContract } from "../../contract";
import type { rpcContract as pagesContract } from "../../pages/contract";
import { REALTIME_CHANNEL as ARTIFACTS_CHANNEL } from "../../artifacts/shared";
import { REALTIME_CHANNEL as DASHBOARDS_CHANNEL } from "../../dashboards/shared";
import { REALTIME_CHANNEL as MINIS_CHANNEL } from "../../minis/shared";
import { REALTIME_CHANNEL as DESIGN_CHANNEL } from "../../design/shared";
import { REALTIME_CHANNEL as DRAW_CHANNEL } from "../../draw/shared";
import { REALTIME_CHANNEL as PAGES_CHANNEL } from "../../pages/constants";
import { RECORDING_CHANGED } from "../../talk/shared/format";
import { appliedKinds } from "../kinds-snapshot";
import { runCreateEntry, startsGroup, useCreateEntries, type CreateEntry } from "../create-menu";
import { collectionKinds, enabledKinds, itemOpening, tabSections, tabTarget, type CollectionKind, type TabKind, type TabKindInfo, type TabTarget } from "./model";

const PageView = lazy(() => import("../../pages/ui/PagePanel").then((module) => ({ default: module.PageTab })));
const DrawingView = lazy(() => import("../../draw/ui/drawing-editor").then((module) => ({ default: module.DrawingEditor })));
const DesignView = lazy(() => import("../../design/ui/design-tab").then((module) => ({ default: module.TabCanvas })));
const DashboardView = lazy(() => import("../../dashboards/ui/dashboard-tab").then((module) => ({ default: module.TabDashboard })));
const MiniView = lazy(() => import("../../minis/ui/mini-view").then((module) => ({ default: module.TabMini })));
const ArtifactView = lazy(() => import("../../artifacts/ui/artifact-viewer").then((module) => ({ default: module.ArtifactViewer })));
const RecordingView = lazy(() => import("../../talk/ui/recordings-panel").then((module) => ({ default: module.RecordingDetail })));
const SavePicker = lazy(() => import("../../artifacts/ui/save-picker").then((module) => ({ default: module.SavePicker })));

type Item = z.output<(typeof rpcContract)["overview"]["output"]>["items"][number];
const BACK = "Studio";

/** One item in its kind's in-thread view. */
export function ItemView({ kind, id, threadId, onBack }: { kind: TabKind; id: string; threadId: string; onBack(): void }) {
  const props = { backLabel: BACK, onBack };
  return (
    <Suspense fallback={null}>
      {kind === "page" ? <PageView key={id} pageId={id} {...props} />
        : kind === "drawing" ? <DrawingView key={id} drawingId={id} threadId={threadId} {...props} />
        : kind === "design" ? <DesignView key={id} designId={id} {...props} />
        : kind === "dashboard" ? <DashboardView key={id} dashboardId={id} {...props} />
        : kind === "mini" ? <MiniView key={id} miniId={id} threadId={threadId} {...props} />
        : kind === "recording" || kind === "dictation" ? <RecordingView key={id} id={id} onBack={onBack} />
        : <ArtifactView key={id} artifactId={id} threadId={threadId} {...props} />}
    </Suspense>
  );
}

export function StudioTab({ threadId, params }: { threadId: string; params: JsonValue | null }) {
  const enabled = useMemo(() => enabledKinds(appliedKinds()?.off ?? new Set()), []);
  const asked = useMemo(() => tabTarget(params, enabled), [params, enabled]);
  const [target, setTarget] = useState<TabTarget>(asked);
  const [filter, setFilter] = useState<string | null>(null);
  // BB keeps this tab mounted when a card opens it on another item, so a new
  // target replaces the one on screen.
  const [openedWith, setOpenedWith] = useState(asked);
  if (JSON.stringify(openedWith) !== JSON.stringify(asked)) {
    setOpenedWith(asked);
    setTarget(asked);
  }
  const back = useCallback(() => setTarget({ view: "list" }), []);

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
      filter={filter}
      onFilter={setFilter}
      onOpen={(kind, id) => setTarget({ view: "item", kind, id })}
      onSave={() => setTarget({ view: "save", seq: null })}
    />
  );
}

/** Refetch when any shown kind changes. A fixed hook per kind, so the count never changes. */
function useKindChanges(onChange: () => void) {
  useRealtime(PAGES_CHANNEL, onChange);
  useRealtime(DRAW_CHANNEL, onChange);
  useRealtime(DESIGN_CHANNEL, onChange);
  useRealtime(DASHBOARDS_CHANNEL, onChange);
  // Mini apps also stream state and records here; only item changes matter.
  useRealtime(MINIS_CHANNEL, (payload) => { if ((payload as { type?: string } | null)?.type === "changed") onChange(); });
  useRealtime(ARTIFACTS_CHANNEL, onChange);
  useRealtime(RECORDING_CHANGED, onChange);
}

function Collection({
  threadId,
  enabled,
  filter,
  onFilter,
  onOpen,
  onSave,
}: {
  threadId: string;
  enabled: readonly TabKindInfo[];
  filter: string | null;
  onFilter(key: string | null): void;
  onOpen(kind: TabKind, id: string): void;
  onSave(): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const pages = useRpc<typeof pagesContract>();
  const sdk = useSdk();
  const [items, setItems] = useState<Item[] | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [thread, setThread] = useState<{ projectId: string | null; status: string } | null>(null);
  const [query, setQuery] = useState("");
  const [requests] = useState(requestGeneration);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(false);
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

  useEffect(() => {
    const current = requests.begin();
    setLoadError(null);
    Promise.all([
      rpc.call("overview", null),
      rpc.call("threadItems", { threadId }).then(({ threads }) => threads.map((each) => `${each.ref.pluginId}:${each.ref.id}`)),
      // A Pages chat's page belongs to its thread too.
      pages.call("pages.chatPage", { threadId }).then((result) => (result.page ? [`pages:${result.page.id}`] : [])),
    ]).then(
      ([overview, links, chatPage]) => {
        if (!current()) return;
        setProviders(overview.providers);
        setItems(overview.items);
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
  const sections = useMemo(() => tabSections(items ?? [], { kinds, filter, query, linked, projectId }), [items, kinds, filter, query, linked, projectId]);
  const creatable = useCreateEntries(rpc, providers, refreshKey);
  const open = (item: Item) => {
    const opening = itemOpening(item, kinds);
    if (opening?.open === "tab") onOpen(opening.kind, opening.id);
    // Add-on kinds have no in-thread view: their page opens in BB's main area, as from the library.
    else if (opening) openAppPath(opening.href);
  };

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
    void runCreateEntry(entry, { rpc, projectId, createKind });
  };

  const shown = filter ? (kinds.find((each) => each.key === filter) ?? null) : null;
  const noun = (shown?.plural ?? "items").toLowerCase();
  return (
    <div className="studio-root flex h-full flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
        <div className="relative min-w-0 flex-1">
          <Icon name="Search" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-8 w-full rounded-md border border-border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
            placeholder={`Search ${noun}…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
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
              <ul role="menu" className="absolute top-full right-0 z-10 mt-1 min-w-40 rounded-md border border-border bg-background p-1 shadow-md">
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
      </div>
      {kinds.length > 1 ? (
        <div role="group" aria-label="Kind" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
          <Chip pressed={!filter} onClick={() => onFilter(null)}>All</Chip>
          {kinds.map((each) => (
            <Chip key={each.key} pressed={filter === each.key} onClick={() => onFilter(filter === each.key ? null : each.key)}>
              {each.plural}
            </Chip>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loadError ? (
          <div role="alert" className="flex flex-col items-start gap-2 px-2 py-3 text-sm">
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
        {loadError && items === null ? null : items === null ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
        ) : sections.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{query ? "Nothing matches." : `No ${noun} yet.${creatable.length ? " New makes one for this thread." : ""}`}</p>
        ) : (
          sections.map((section) => (
            <section key={section.title} className="mb-3">
              <h3 className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{section.title}</h3>
              <ul className="flex flex-col">
                {section.items.map((item) => (
                  <li key={`${item.pluginId}:${item.id}`}>
                    <ItemRow item={item} info={kinds.find((each) => each.key === `${item.pluginId}:${item.kind}`)!} onOpen={() => open(item)} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="h-7 shrink-0 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground"
    >
      {children}
    </button>
  );
}

function ItemRow({ item, info, onOpen }: { item: Item; info: CollectionKind; onOpen(): void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-state-hover"
      onClick={onOpen}
      {...studioItemProps({ href: item.href, title: untitled(item.title), icon: info.icon })}
    >
      {item.thumbnailUrl && !failed ? (
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
          <img src={item.thumbnailUrl} alt="" loading="lazy" className={cn(THUMBNAIL, "p-0.5")} onError={() => setFailed(true)} />
        </span>
      ) : (
        <ItemTile icon={item.icon} kindIcon={info.icon} />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", !item.title.trim() && "text-muted-foreground")}>{untitled(item.title)}</span>
        <span className="block truncate text-xs text-muted-foreground">{item.preview ? `${info.label} · ${item.preview}` : info.label}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.updatedAt)}</span>
    </button>
  );
}

export default StudioTab;
