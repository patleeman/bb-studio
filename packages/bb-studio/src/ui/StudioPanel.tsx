// The Studio collection: every add-on's items in one list, filtered by one
// query (src/query.ts) from search and the filter menus above it. It is the
// workspace's new tab page, never a page of its own: openCollection starts it
// on a kind, so /plugins/studio/studio/recording opens it on recordings, and
// openSpaceItems on a space's items.
import { showBrowse } from "./Workspace";
import {
  CollectionPage,
  createStudioItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  ICON_BUTTON,
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
import { mentionPrompt, STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { errorMessage, untitled } from "@bb-studio/kit/format";
import { useBbContext, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ProviderView, rpcContract, SavedViewView, SidebarView, SpaceView, TagView } from "../contract";
import { applyItemChanges } from "../partial";
import { compileQuery, facetCounts, formatQuery, parseQuery, resolveValue, type Query, type QueryVocabulary } from "../query";
import { SearchFreshness, useSearchFreshness } from "./SearchFreshness";
import { QueryBar } from "./QueryBar";
import { FilterToolbar } from "./FilterToolbar";
import { SpaceGlyph } from "./Spaces";
import { SpaceFiles } from "./SpaceFiles";

type Overview = { providers: ProviderView[]; items: (CollectionItem & { spaces?: string[] })[]; tags: TagView[]; spaces: SpaceView[]; views: SavedViewView[] };
const REFETCH_DEBOUNCE_MS = 300;
const SEARCH_DEBOUNCE_MS = 200;
const EMPTY_QUERY: Query = { filters: [], text: "" };

const QUERY_KEY = "studio:query:all";
const QUERY_EVENT = "studio:query";

/** Opens the Studio collection on `query`, e.g. a space's items. */
export function openCollectionQuery(navigate: ReturnType<typeof useBbNavigate>, query: Query): void {
  try {
    localStorage.setItem(QUERY_KEY, formatQuery(query));
  } catch {
    // Private windows can refuse storage; an open collection still hears the event.
  }
  window.dispatchEvent(new CustomEvent(QUERY_EVENT, { detail: formatQuery(query) }));
  // The workspace's new tab page shows it.
  showBrowse();
  navigate.toPluginPanel("studio", { subPath: "" });
}

/** Opens the new tab page, on `kind`'s items when given, from an old address that showed the list. */
export function openCollection(kind: string | null): void {
  if (kind) {
    const query = { filters: [{ field: "kind" as const, value: kind }], text: "" };
    try {
      localStorage.setItem(QUERY_KEY, formatQuery(query));
    } catch {
      // Storage can be refused; an open collection still hears the event.
    }
    window.dispatchEvent(new CustomEvent(QUERY_EVENT, { detail: formatQuery(query) }));
  }
  showBrowse();
}

/** Opens the Studio collection on a space's items. */
export function openSpaceItems(navigate: ReturnType<typeof useBbNavigate>, space: { name: string }): void {
  openCollectionQuery(navigate, { filters: [{ field: "space", value: space.name }], text: "" });
}

const FILES_KEY = "studio:space-files";
const FILES_EVENT = "studio:space-files";

/** Opens a space on its Files view, showing `threadId`'s worktree. */
export function openSpaceFiles(navigate: ReturnType<typeof useBbNavigate>, space: { name: string }, threadId: string | null): void {
  const detail = JSON.stringify({ threadId });
  try {
    sessionStorage.setItem(FILES_KEY, detail);
  } catch {
    // Storage can be refused; an open collection still hears the event.
  }
  window.dispatchEvent(new CustomEvent(FILES_EVENT, { detail }));
  openSpaceItems(navigate, space);
}

/** The Files view asked for by openSpaceFiles, taken once. */
function takeFilesRequest(): { threadId: string | null } | null {
  try {
    const raw = sessionStorage.getItem(FILES_KEY);
    sessionStorage.removeItem(FILES_KEY);
    return raw ? (JSON.parse(raw) as { threadId: string | null }) : null;
  } catch {
    return null;
  }
}

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
  useEffect(() => {
    if (key !== QUERY_KEY) return;
    const onQuery = (event: Event) => setStored({ key, query: parseQuery((event as CustomEvent<string>).detail) });
    window.addEventListener(QUERY_EVENT, onQuery);
    return () => window.removeEventListener(QUERY_EVENT, onQuery);
  }, [key]);
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
  if (kind === "table") return "csv";
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

/** The workspace's new tab page. */
export function StudioPanel() {
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
  const [query, setQuery] = useStoredQuery(QUERY_KEY);
  const setKind = useCallback((next: string) => {
    setQuery({ ...query, filters: [...query.filters.filter((filter) => filter.field !== "kind"), ...(next === "all" ? [] : [{ field: "kind" as const, value: next }])] });
  }, [query, setQuery]);
  const vocabulary = useMemo<QueryVocabulary>(
    () => ({ kinds, projects: projects.map((project) => ({ id: project.id, name: project.name })), tags: data?.tags ?? [], spaces: data?.spaces ?? [] }),
    [kinds, projects, data?.tags, data?.spaces],
  );
  // Words being typed after the last filter search; a field still waiting for its value doesn't.
  const searchText = useMemo(() => parseQuery(query.text).text.trim(), [query.text]);
  const freshness = useSearchFreshness(Boolean(searchText));
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
  }, [rpc, searchText, freshness.revision]);
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
  const nameOf = useCallback((pluginId: string) => providers.find((provider) => provider.pluginId === pluginId)?.name ?? pluginId, [providers]);

  const handlers = useMemo<CollectionHandlers>(
    () => ({
      onOpen: (item) => openAppPath(item.href),
      onCreate: (target, projectId) => createStudioItem(target, {
        projectId,
        addOn: nameOf(target.pluginId),
        create: async () => (await rpc.call("create", { pluginId: target.pluginId, kind: target.id, projectId })).item.href,
      }),
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
          : item.kind === "table" ? [{ format: "csv", label: "CSV" }, { format: "markdown", label: "Markdown" }]
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

  const filteredSpaces = (data?.spaces ?? []).filter((each) =>
    query.filters.some((filter) => filter.field === "space" && !filter.negate && filter.value.toLowerCase() === each.name.toLowerCase()),
  );
  const collectionSpaces = useMemo(
    () => (data?.spaces ?? []).map((each) => ({ id: each.id, name: each.name, glyph: <SpaceGlyph space={each} className="w-3.5 text-center text-xs leading-none" /> })),
    [data?.spaces],
  );
  // One space in the query: its documents, or its files.
  const [filesRequest] = useState(takeFilesRequest);
  const [showFiles, setShowFiles] = useState(Boolean(filesRequest));
  const [filesThread, setFilesThread] = useState<string | null>(filesRequest?.threadId ?? null);
  useEffect(() => {
    const onFiles = (event: Event) => {
      takeFilesRequest();
      setShowFiles(true);
      setFilesThread((JSON.parse((event as CustomEvent<string>).detail) as { threadId: string | null }).threadId);
    };
    window.addEventListener(FILES_EVENT, onFiles);
    return () => window.removeEventListener(FILES_EVENT, onFiles);
  }, []);
  const fileSpace = filteredSpaces.length === 1 ? filteredSpaces[0]! : null;
  const spaceViews = fileSpace ? (
    <div role="tablist" aria-label={`${fileSpace.name} views`} className="mb-3 inline-flex rounded-md border border-border p-0.5 text-sm">
      {([["Items", false], ["Files", true]] as const).map(([label, files]) => (
        <button key={label} type="button" role="tab" aria-selected={showFiles === files} onClick={() => setShowFiles(files)} className={`rounded px-3 py-1 ${showFiles === files ? "bg-state-active font-medium" : "text-muted-foreground hover:bg-state-hover"}`}>
          {label}
        </button>
      ))}
    </div>
  ) : null;
  const notice = (
    <>
      {spaceViews}
      {searchText ? <SearchFreshness {...freshness} /> : null}
      {unavailable.map((provider) => (
        <p key={provider.pluginId} className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="AlertTriangle" className="size-4 shrink-0" />
          {provider.detail ?? `${provider.name} isn't available.`}
        </p>
      ))}
    </>
  );

  const headerActions = (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Studio options"
          title="Studio options"
          className={ICON_BUTTON}
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
            <span className="ml-auto text-xs text-muted-foreground">{provider.state === "ready" ? "Ready" : "Offline"}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );

  if (data && !providers.length) {
    return (
      <PageColumn className="pt-6">
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
  const empty = compiled.unknown.length
    ? `Nothing is called ${compiled.unknown.map((filter) => `${filter.field}:${filter.value}`).join(", ")}.`
    : compiled.archived
      ? "Nothing archived matches."
      : filteredSpaces.length && !searchText && query.filters.length === filteredSpaces.length
        ? spaceEmpty(filteredSpaces)
        : searchText || query.filters.length
          ? "Nothing matches."
          : "No items yet.";

  if (fileSpace && showFiles) {
    return (
      <PageColumn className="pt-6">
        <h1 className="mb-3 flex items-center gap-2 text-xl font-semibold">
          <SpaceGlyph space={fileSpace} className="w-5 text-center" /> {fileSpace.name}
        </h1>
        {spaceViews}
        <SpaceFiles space={fileSpace} threadId={filesThread} canOpenCode={providers.some((provider) => provider.pluginId === "studio-code" && provider.state === "ready")} />
      </PageColumn>
    );
  }

  return (
    <>
      <CollectionPage
        title="Studio"
        kinds={kinds}
        items={shownItems}
        error={error && !data ? error : null}
        projects={projects}
        defaultProjectId={onlyProject ? onlyProject.id : (context.projectId ?? null)}
        storageKey="studio:collection"
        tags={data?.tags ?? []}
        spaces={collectionSpaces}
        extraCreateItems={extraCreateItems}
        kind={onlyKind?.id ?? "all"}
        onKindChange={setKind}
        notice={notice}
        headerActions={headerActions}
        handlers={handlers}
        filter={{
          bar: <QueryBar query={query} vocabulary={vocabulary} onChange={setQuery} loading={!data || !projects.length} />,
          toolbar: <FilterToolbar query={query} vocabulary={vocabulary} counts={counts} onChange={setQuery} spaces={data?.spaces ?? []} views={data?.views ?? []} tags={data?.tags ?? []} onSaveView={() => void saveView()} onDeleteView={(view) => void deleteView(view)} />,
          text: searchText,
          snippets,
          archived: compiled.archived,
          empty,
        }}
      />
    </>
  );
}

/** An itemless space: its threads and projects are in the sidebar. */
function spaceEmpty(spaces: readonly SpaceView[]): string {
  return `No items in ${spaces.length === 1 ? "this space" : "these spaces"} yet.`;
}
