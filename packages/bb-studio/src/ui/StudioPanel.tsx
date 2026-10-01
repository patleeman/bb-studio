// The Studio collection: every add-on's items in one list, filtered by one
// query (src/query.ts) from the bar above it and the rail beside it. The
// panel's sub-path can start the query on a kind, so
// /plugins/studio/studio/recording links to recordings; space/<id> opens a
// space's page in Pages, or Studio's own home for it without Pages
// (Spaces.tsx), and space/<id>/items lists the space's items here by
// filtering on it.
import {
  CollectionPage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  OUTLINE_BUTTON,
  itemKey,
  PageColumn,
  openAppPath,
  useProjects,
  type ActionResults,
  type CollectionHandlers,
  type CollectionItem,
  type CollectionKind,
  type CollectionTag,
} from "@bb-studio/kit/app";
import { mentionPrompt, STUDIO_REALTIME_CHANNEL, type StudioCreateEventDetail } from "@bb-studio/kit/contract";
import { errorMessage, untitled } from "@bb-studio/kit/format";
import { useBbContext, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ProviderView, rpcContract, SavedViewView, SidebarView, SpaceView, TagView } from "../contract";
import { applyItemChanges } from "../partial";
import { compileQuery, facetCounts, formatQuery, parseQuery, resolveValue, type Query, type QueryVocabulary } from "../query";
import { NeedsYou } from "./HomePanel";
import { FacetRail, FiltersDialog, QueryBar } from "./QueryBar";
import { AddItemsDialog, AddThreadsDialog, DeleteSpaceDialog, SpaceDialog, SpaceGlyph, SpaceHome, useSpaceThreads, type ThreadKind } from "./Spaces";

type Overview = { providers: ProviderView[]; items: (CollectionItem & { spaces?: string[] })[]; tags: TagView[]; spaces: SpaceView[]; views: SavedViewView[] };
type SpaceDialogState = { type: "edit" | "items" | "delete"; space: SpaceView } | { type: "threads"; space: SpaceView; kind: ThreadKind } | null;
const REFETCH_DEBOUNCE_MS = 300;
const SEARCH_DEBOUNCE_MS = 200;
const EMPTY_QUERY: Query = { filters: [], text: "" };

/** The query, remembered across visits. */
function useStoredQuery(key: string): [Query, (query: Query) => void] {
  const read = useCallback(() => {
    try {
      return parseQuery(localStorage.getItem(key) ?? "");
    } catch {
      return EMPTY_QUERY;
    }
  }, [key]);
  const [stored, setStored] = useState(() => ({ key, query: read() }));
  const query = stored.key === key ? stored.query : read();
  useEffect(() => {
    if (stored.key !== key) setStored({ key, query: read() });
  }, [key, read, stored.key]);
  const set = useCallback(
    (next: Query) => {
      setStored({ key, query: next });
      try {
        localStorage.setItem(key, formatQuery(next));
      } catch {
        // Private windows can refuse storage; the query lasts this session.
      }
    },
    [key],
  );
  return [query, set];
}

function downloadFile(file: { name: string; mime: string; data: string }): void {
  const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function defaultExportFormat(kind: string): string {
  if (kind === "drawing") return "png";
  if (kind === "artifact") return "original";
  return "markdown";
}

function useOverview(rpc: ReturnType<typeof useRpc<typeof rpcContract>>) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One request at a time; a change during a request fetches once more after.
  const running = useRef(false);
  const again = useRef(false);
  const cursor = useRef<number | null>(null);
  const refetch = useCallback(() => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    Promise.all([rpc.call("changes", { since: 0 }), rpc.call("overview", null)])
      .then(
        ([checkpoint, result]) => {
          setData(result);
          cursor.current = checkpoint.cursor;
          setError(null);
          // An item can change while overview is being fetched.
          rpc.call("changes", { since: checkpoint.cursor }).then((later) => {
            if (later.reset || later.changes.length) refetch();
          }, () => refetch());
        },
        (cause: unknown) => setError(errorMessage(cause)),
      )
      .finally(() => {
        running.current = false;
        if (again.current) {
          again.current = false;
          refetch();
        }
      });
  }, [rpc]);

  useEffect(() => {
    refetch();
    const onVisible = () => document.visibilityState === "visible" && refetch();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetch]);

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const catchUp = useCallback(async () => {
    if (cursor.current === null) { refetch(); return; }
    try {
      const result = await rpc.call("changes", { since: cursor.current });
      if (result.reset) { refetch(); return; }
      const groups = new Map<string, string[]>();
      for (const change of result.changes) {
        if (change.removed) continue;
        groups.set(change.pluginId, [...(groups.get(change.pluginId) ?? []), change.id]);
      }
      const fetched = await Promise.all([...groups].map(([pluginId, ids]) => rpc.call("items", { pluginId, ids })));
      const updated = fetched.flatMap(({ items }) => items);
      setData((previous) => previous && {
        ...previous,
        items: applyItemChanges(previous.items, updated, result.changes.filter((change) => change.removed)),
      });
      cursor.current = result.cursor;
    } catch { refetch(); }
  }, [rpc, refetch]);
  useRealtime(STUDIO_REALTIME_CHANNEL, () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void catchUp(); }, REFETCH_DEBOUNCE_MS);
  });
  return { data, error, refetch, setData };
}

function useSidebar(rpc: ReturnType<typeof useRpc<typeof rpcContract>>) {
  const [sidebar, setSidebar] = useState<SidebarView | null>(null);
  useEffect(() => {
    rpc.call("sidebar", null).then(setSidebar, () => setSidebar(null));
  }, [rpc]);
  const setVisible = useCallback(
    (visible: boolean) =>
      rpc.call("setSidebar", { visible }).then(
        (next) => {
          setSidebar(next);
          toast.success(visible ? "Add-ons are back in the sidebar" : "Add-ons hidden from the sidebar");
        },
        (cause: unknown) => toast.error(`Couldn't change the sidebar: ${errorMessage(cause)}`),
      ),
    [rpc],
  );
  return { sidebar, setVisible };
}

async function perPlugin(items: CollectionItem[], work: (pluginId: string, ids: string[]) => Promise<ActionResults>): Promise<ActionResults> {
  const groups = new Map<string, string[]>();
  for (const item of items) groups.set(item.pluginId, [...(groups.get(item.pluginId) ?? []), item.id]);
  const results = await Promise.all(
    [...groups].map(([pluginId, ids]) =>
      work(pluginId, ids).catch((cause: unknown) => ({ done: [], failed: ids.map((id) => ({ id, error: errorMessage(cause) })) })),
    ),
  );
  return { done: results.flatMap((result) => result.done), failed: results.flatMap((result) => result.failed) };
}

export function StudioPanel({ subPath }: { subPath: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const context = useBbContext();
  const projects = useProjects();
  const { data, error, refetch, setData } = useOverview(rpc);
  const { sidebar, setVisible } = useSidebar(rpc);
  const [templates, setTemplates] = useState<{ pluginId: string; id: string; title: string }[]>([]);
  useEffect(() => {
    rpc.call("templates", null).then(({ items }) => setTemplates(items), () => setTemplates([]));
  }, [rpc, data?.items]);
  const providers = useMemo(() => data?.providers ?? [], [data]);
  const kinds = useMemo<CollectionKind[]>(
    () => providers.filter((provider) => provider.state === "ready").flatMap((provider) => provider.kinds.map((kind) => ({ ...kind, pluginId: provider.pluginId }))),
    [providers],
  );
  const segments = subPath.split("/").filter(Boolean);
  const spaceId = segments[0] === "space" ? decodeSegment(segments[1] ?? "") || null : null;
  const space = spaceId ? (data?.spaces.find((each) => each.id === spaceId) ?? null) : null;
  const requested = (spaceId ? "" : decodeSegment(segments[0] ?? "")) || "all";
  const setKind = useCallback((next: string) => navigate.toPluginPanel("studio", { subPath: next === "all" ? "" : encodeURIComponent(next) }), [navigate]);
  const openSpace = useCallback((id: string | null) => navigate.toPluginPanel("studio", { subPath: id ? `space/${encodeURIComponent(id)}` : "" }), [navigate]);
  const spaceThreads = useSpaceThreads(rpc, space);
  const [spaceDialog, setSpaceDialog] = useState<SpaceDialogState>(null);
  // A space deleted elsewhere falls back to everything.
  useEffect(() => {
    if (data && spaceId && !space) openSpace(null);
  }, [data, spaceId, space, openSpace]);

  const [query, setQuery] = useStoredQuery("studio:query:all");
  // A space opens its page; without Pages, the home below.
  const listSpace = segments[2] === "items";
  const [homeless, setHomeless] = useState<string | null>(null);
  useEffect(() => {
    if (!spaceId || listSpace) return;
    let live = true;
    rpc.call("spacePage", { id: spaceId }).then(
      ({ href }) => live && (href ? openAppPath(href, { replace: true }) : setHomeless(spaceId)),
      () => live && setHomeless(spaceId),
    );
    return () => {
      live = false;
    };
  }, [rpc, spaceId, listSpace]);
  useEffect(() => {
    if (!listSpace || !space) return;
    setQuery({ filters: [{ field: "space", value: space.name }], text: "" });
    navigate.toPluginPanel("studio", { subPath: "", replace: true });
  }, [listSpace, space, setQuery, navigate]);
  // A link to a kind starts the query on it.
  const seededKind = useRef<string | null>(null);
  useEffect(() => {
    if (!data || !kinds.some((each) => each.id === requested) || seededKind.current === `${spaceId}/${requested}`) return;
    seededKind.current = `${spaceId}/${requested}`;
    setQuery({ ...query, filters: [...query.filters.filter((filter) => filter.field !== "kind"), { field: "kind", value: requested }] });
  }, [data, kinds, requested, spaceId, query, setQuery]);
  const vocabulary = useMemo<QueryVocabulary>(
    () => ({ kinds, projects: projects.map((project) => ({ id: project.id, name: project.name })), tags: data?.tags ?? [], spaces: data?.spaces ?? [] }),
    [kinds, projects, data?.tags, data?.spaces],
  );
  // Words being typed after the last filter search; a field still waiting for its value doesn't.
  const searchText = useMemo(() => parseQuery(query.text).text.trim(), [query.text]);
  const [snippets, setSnippets] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  useEffect(() => {
    if (!searchText) {
      setSnippets(new Map());
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      rpc.call("search", { query: searchText }).then(
        ({ keys, snippets: found }) => live && setSnippets(new Map(keys.map((key) => [key, found[key] ?? null]))),
        () => {},
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rpc, searchText]);
  const compiled = useMemo(() => compileQuery({ filters: query.filters, text: searchText }, vocabulary), [query.filters, searchText, vocabulary]);
  const matchesText = useCallback(
    (item: CollectionItem) => !searchText || untitled(item.title).toLowerCase().includes(searchText.toLowerCase()) || snippets.has(itemKey(item)),
    [searchText, snippets],
  );
  const shownItems = useMemo(() => data?.items.filter((item) => compiled.test(item) && matchesText(item)) ?? null, [data, compiled, matchesText]);
  const counts = useMemo(() => facetCounts(data?.items ?? [], compiled, (item) => matchesText(item as CollectionItem)), [data, compiled, matchesText]);
  // One kind or project in the query picks the columns and where new items go.
  const only = (field: "kind" | "project") => {
    const ids = [...new Set(query.filters.filter((filter) => filter.field === field && !filter.negate).map((filter) => resolveValue(filter, vocabulary)))];
    return ids.length === 1 && ids[0] !== undefined ? { id: ids[0] } : null;
  };
  const onlyKind = only("kind");
  const onlyProject = only("project");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const nameOf = useCallback((pluginId: string) => providers.find((provider) => provider.pluginId === pluginId)?.name ?? pluginId, [providers]);

  const handlers = useMemo<CollectionHandlers>(
    () => ({
      onOpen: (item) => openAppPath(item.href),
      onCreate: async (target, projectId) => {
        if (!target.create) return;
        if (target.create.mode === "event") {
          // Client-side creation, like starting a Talk recording.
          const event = new CustomEvent<StudioCreateEventDetail>(target.create.event, { detail: { projectId }, cancelable: true });
          window.dispatchEvent(event);
          if (!event.defaultPrevented) toast.error(`${nameOf(target.pluginId)} isn't loaded yet. Reload BB and try again.`);
          return;
        }
        try {
          const { item } = await rpc.call("create", { pluginId: target.pluginId, kind: target.id, projectId });
          openAppPath(item.href);
        } catch (cause) {
          toast.error(`Couldn't create a ${target.label.toLowerCase()}: ${errorMessage(cause)}`);
        }
      },
      onNewThread: (items) => navigate.toCompose({ initialPrompt: mentionPrompt(items), focusPrompt: true }),
      onDuplicate: async (item) => {
        try {
          const { item: created } = await rpc.call("duplicate", { pluginId: item.pluginId, id: item.id, projectId: item.projectId, includeChildren: item.kind === "page" });
          refetch(); openAppPath(created.href);
        } catch (cause) { toast.error(`Couldn't duplicate: ${errorMessage(cause)}`); }
      },
      onSetTemplate: async (item, template) => {
        try { await rpc.call("setTemplate", { pluginId: item.pluginId, id: item.id, template }); refetch(); toast.success(template ? "Saved as template" : "Template removed"); }
        catch (cause) { toast.error(`Couldn't change template: ${errorMessage(cause)}`); }
      },
      exportFormats: (item) => item.kind === "page" ? [{ format: "markdown", label: "Markdown and assets" }, { format: "html", label: "HTML and assets" }, { format: "pdf", label: "PDF" }]
        : item.kind === "drawing" ? [{ format: "png", label: "PNG" }, { format: "svg", label: "SVG" }, { format: "excalidraw", label: "Excalidraw JSON" }]
          : item.kind === "task" ? [{ format: "markdown", label: "Markdown" }, { format: "csv", label: "CSV" }]
            : item.kind === "recording" || item.kind === "dictation" ? [{ format: "markdown", label: "Transcript Markdown" }, { format: "audio", label: "Audio segments" }, { format: "bundle", label: "Transcript and audio" }]
              : [{ format: "original", label: "Original file" }],
      onExport: async (item, format) => {
        try {
          const { files } = await rpc.call("exportItem", { pluginId: item.pluginId, id: item.id, format });
          if (files.length === 1) downloadFile(files[0]!);
          else downloadFile(await rpc.call("exportBulk", { items: [{ pluginId: item.pluginId, id: item.id, format }] }));
        } catch (cause) { toast.error(`Couldn't export: ${errorMessage(cause)}`); }
      },
      onExportBulk: async (items) => {
        try { downloadFile(await rpc.call("exportBulk", { items: items.map((item) => ({ pluginId: item.pluginId, id: item.id, format: defaultExportFormat(item.kind) })) })); }
        catch (cause) { toast.error(`Couldn't export ZIP: ${errorMessage(cause)}`); }
      },
      onMove: async (items, projectId) => {
        const result = await perPlugin(items, (pluginId, ids) => rpc.call("move", { pluginId, ids, projectId }));
        refetch();
        return result;
      },
      onArchive: async (items, archived) => {
        const result = await perPlugin(items, (pluginId, ids) => rpc.call("archive", { pluginId, ids, archived }));
        refetch();
        return result;
      },
      onDelete: async (items) => {
        const result = await perPlugin(items, (pluginId, ids) => rpc.call("remove", { pluginId, ids }));
        refetch();
        return result;
      },
      onAction: async (target, action, items) => {
        const result = await rpc.call("action", { pluginId: target.pluginId, action: action.id, ids: items.map((item) => item.id) });
        refetch();
        return result;
      },
      onSearch: async (query) => {
        const { keys, snippets } = await rpc.call("search", { query });
        return new Map(keys.map((key) => [key, snippets[key] ?? null]));
      },
      onTag: async (items, add, remove) => {
        // Show the change now; the refetch confirms it.
        const keys = new Set(items.map((item) => `${item.pluginId}:${item.id}`));
        setData((previous) =>
          previous && {
            ...previous,
            items: previous.items.map((item) =>
              keys.has(`${item.pluginId}:${item.id}`)
                ? { ...item, tags: [...new Set([...(item.tags ?? []), ...add])].filter((id) => !remove.includes(id)) }
                : item,
            ),
          },
        );
        try {
          await rpc.call("tagItems", { items: items.map((item) => ({ pluginId: item.pluginId, id: item.id })), add, remove });
        } finally {
          refetch();
        }
      },
      onCreateTag: async (name): Promise<CollectionTag> => {
        const { tag } = await rpc.call("createTag", { name });
        setData((previous) => previous && { ...previous, tags: previous.tags.some((each) => each.id === tag.id) ? previous.tags : [...previous.tags, tag] });
        return tag;
      },
      onRenameTag: async (tag, name) => {
        await rpc.call("renameTag", { id: tag.id, name });
        refetch();
      },
      onDeleteTag: async (tag) => {
        await rpc.call("deleteTag", { id: tag.id });
        toast.success(`Deleted the tag ${tag.name}`);
        refetch();
      },
    }),
    [nameOf, navigate, refetch, rpc, setData],
  );

  const shownPanels = sidebar?.panels.filter((panel) => panel.visible) ?? [];
  const unavailable = providers.filter((provider) => provider.state !== "ready");
  const extraCreateItems = [
    ...templates.map((item) => ({ id: `template:${item.pluginId}:${item.id}`, label: `From template: ${item.title || "Untitled"}`, icon: "Copy", onSelect: (projectId: string | null) => {
      const name = window.prompt("Name for this template (optional)", "");
      if (name === null) return;
      void rpc.call("instantiateTemplate", { pluginId: item.pluginId, id: item.id, projectId, variables: { name } }).then(({ item: created }) => { refetch(); openAppPath(created.href); }, (cause: unknown) => toast.error(`Couldn't use template: ${errorMessage(cause)}`));
    } })),
  ];

  // Filtering to a space links to its page, where its threads, channels and projects are.
  const filteredSpaces = (data?.spaces ?? []).filter((each) =>
    query.filters.some((filter) => filter.field === "space" && !filter.negate && filter.value.toLowerCase() === each.name.toLowerCase()),
  );
  const notice = (
    <>
      {filteredSpaces.map((each) => (
        <div key={each.id} className="mb-3 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <SpaceGlyph space={each} className="text-sm leading-none" />
          <span className="min-w-0 truncate font-medium">{each.name}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{each.description || "Showing this space's items"}</span>
          <button type="button" className={OUTLINE_BUTTON} onClick={() => openSpace(each.id)}>
            Open space page <Icon name="ArrowRight" />
          </button>
        </div>
      ))}
      <NeedsYou />
      {unavailable.map((provider) => (
        <p key={provider.pluginId} className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name={provider.state === "outdated" ? "Info" : "AlertTriangle"} className="size-4 shrink-0" />
          {provider.detail ?? `${provider.name} isn't available.`}
        </p>
      ))}
    </>
  );

  const headerActions = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Studio options"
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active"
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => navigate.toPluginPanel("studio", { subPath: "activity" })}>
          <Icon name="ChartColumn" className="size-4" /> Activity
        </DropdownMenuItem>
        {sidebar?.panels.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Add-ons in the sidebar</DropdownMenuLabel>
            {shownPanels.length ? (
              <DropdownMenuItem onSelect={() => void setVisible(false)}>
                <Icon name="EyeOff" className="size-4" /> Hide {sidebar.panels.map((panel) => panel.label).join(", ")}
              </DropdownMenuItem>
            ) : null}
            {shownPanels.length < sidebar.panels.length ? (
              <DropdownMenuItem onSelect={() => void setVisible(true)}>
                <Icon name="Eye" className="size-4" /> Show {sidebar.panels.map((panel) => panel.label).join(", ")}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Add-ons</DropdownMenuLabel>
        {providers.map((provider) => (
          <DropdownMenuItem key={provider.pluginId} disabled className="opacity-100">
            <span className="truncate">{provider.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{provider.state === "ready" ? "Ready" : provider.state === "outdated" ? "Needs update" : "Offline"}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (data && !providers.length) {
    return (
      <PageColumn>
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Studio</h1>
        <EmptyState icon="studio/studio" title="No add-ons installed">
          Install one from Extensions.
        </EmptyState>
      </PageColumn>
    );
  }

  const saveView = async () => {
    const name = window.prompt("Name this view", "");
    if (!name?.trim()) return;
    try {
      await rpc.call("saveView", { name, query: formatQuery(query) });
      toast.success(`Saved the view ${name.trim()}`);
      refetch();
    } catch (cause) {
      toast.error(`Couldn't save the view: ${errorMessage(cause)}`);
    }
  };
  const deleteView = async (view: SavedViewView) => {
    try {
      await rpc.call("deleteView", { id: view.id });
      toast.success(`Deleted the view ${view.name}`);
      refetch();
    } catch (cause) {
      toast.error(`Couldn't delete the view: ${errorMessage(cause)}`);
    }
  };
  const rail = data ? (
    <FacetRail
      query={query}
      vocabulary={vocabulary}
      counts={counts}
      onChange={setQuery}
      spaces={data.spaces}
      views={data.views}
      onSaveView={() => void saveView()}
      onDeleteView={(view) => void deleteView(view)}
      tags={data.tags}
    />
  ) : null;
  const empty = compiled.unknown.length
    ? `Nothing is called ${compiled.unknown.map((filter) => `${filter.field}:${filter.value}`).join(", ")}.`
    : compiled.archived
      ? "Nothing archived matches."
      : filteredSpaces.length && !searchText && query.filters.length === filteredSpaces.length
        ? "No items in this space yet. Open its page to add items, projects, threads and channels."
        : searchText || query.filters.length
          ? "Nothing matches."
          : "No items yet.";

  // New items go to the space's default project and join the space itself.
  const createInSpace = async (target: CollectionKind, into: SpaceView) => {
    if (target.create?.mode !== "rpc") return handlers.onCreate?.(target, into.defaultProjectId);
    try {
      const { item } = await rpc.call("create", { pluginId: target.pluginId, kind: target.id, projectId: into.defaultProjectId });
      await rpc.call("spaceMembers", { id: into.id, add: [{ pluginId: target.pluginId, id: item.id }], remove: [] });
      refetch();
      openAppPath(item.href);
    } catch (cause) {
      toast.error(`Couldn't create a ${target.label.toLowerCase()}: ${errorMessage(cause)}`);
    }
  };
  const liveSpace = (each: SpaceView) => data?.spaces.find((candidate) => candidate.id === each.id) ?? each;
  const deleteSpace = async (target: SpaceView) => {
    setSpaceDialog(null);
    try {
      await rpc.call("deleteSpace", { id: target.id });
      toast.success(`Deleted the space ${target.name}`);
      openSpace(null);
      refetch();
    } catch (cause) {
      toast.error(`Couldn't delete the space: ${errorMessage(cause)}`);
    }
  };

  return (
    <>
      {space && (listSpace || homeless !== space.id) ? null : space ? (
        <SpaceHome
          rpc={rpc}
          space={space}
          items={data?.items.filter((item) => !item.archived && item.spaces?.includes(space.id)) ?? []}
          threads={spaceThreads}
          kinds={kinds}
          projects={projects}
          onEdit={() => setSpaceDialog({ type: "edit", space })}
          onDelete={() => setSpaceDialog({ type: "delete", space })}
          onAddItems={() => setSpaceDialog({ type: "items", space })}
          onAddThreads={(kind) => setSpaceDialog({ type: "threads", space, kind })}
          onShowItems={() => {
            setQuery({ filters: [{ field: "space", value: space.name }], text: "" });
            openSpace(null);
          }}
          onCreate={(target) => void createInSpace(target, space)}
          onChanged={refetch}
        />
      ) : (
        <CollectionPage
          title="Studio"
          kinds={kinds}
          items={shownItems}
          error={error && !data ? error : null}
          projects={projects}
          defaultProjectId={onlyProject ? onlyProject.id : (context.projectId ?? null)}
          storageKey="studio:collection"
          tags={data?.tags ?? []}
          extraCreateItems={extraCreateItems}
          kind={onlyKind?.id ?? "all"}
          onKindChange={setKind}
          notice={notice}
          headerActions={headerActions}
          handlers={handlers}
          filter={{
            bar: <QueryBar query={query} vocabulary={vocabulary} onChange={setQuery} onOpenFilters={() => setFiltersOpen(true)} />,
            rail,
            text: searchText,
            snippets,
            archived: compiled.archived,
            empty,
          }}
        />
      )}
      <FiltersDialog open={filtersOpen} onClose={() => setFiltersOpen(false)}>
        {rail}
      </FiltersDialog>
      {spaceDialog?.type === "edit" ? (
        <SpaceDialog
          rpc={rpc}
          space={spaceDialog.space}
          projects={projects}
          defaultProjectId={context.projectId ?? null}
          onClose={() => setSpaceDialog(null)}
          onSaved={(saved) => {
            setSpaceDialog(null);
            refetch();
            openSpace(saved.id);
          }}
          onDelete={() => setSpaceDialog({ type: "delete", space: spaceDialog.space })}
        />
      ) : null}
      {spaceDialog?.type === "items" ? (
        <AddItemsDialog rpc={rpc} space={liveSpace(spaceDialog.space)} items={data?.items ?? []} kinds={kinds} projects={projects} onClose={() => setSpaceDialog(null)} onChanged={refetch} />
      ) : null}
      {spaceDialog?.type === "threads" ? (
        <AddThreadsDialog rpc={rpc} space={liveSpace(spaceDialog.space)} kind={spaceDialog.kind} projects={projects} onClose={() => setSpaceDialog(null)} onChanged={refetch} />
      ) : null}
      {spaceDialog?.type === "delete" ? (
        <DeleteSpaceDialog space={spaceDialog.space} onClose={() => setSpaceDialog(null)} onConfirm={() => void deleteSpace(spaceDialog.space)} />
      ) : null}
    </>
  );
}

/** A path segment, or "" for a malformed one like `100%`. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}
