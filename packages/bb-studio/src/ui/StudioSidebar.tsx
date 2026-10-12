// The Studio sidebar: Studio's thread list provider ("Studio (Studio)"), which
// replaces BB's thread list while the Studio panel shows (bot/threadListSwitch.ts).
// New (Studio's New menu), then the kinds with their counts, saved views, tags,
// pinned items and recent ones (studio-sidebar-model.ts). A kind, view or tag
// filters the library on the new tab page; an item opens as a Studio tab.
import {
  createStudioItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  openAppPath,
  TagDot,
  usePathname,
  useProjects,
  type CollectionItem,
} from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { useBbContext, useRealtime, useRpc, useSdk, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProviderView, rpcContract, SavedViewView, TabView, TagView } from "../contract";
import { TABS_CHANNEL } from "../ids";
import { canonicalPath } from "../builtins";
import { appliedKinds } from "./kinds-snapshot";
import { showLibrary, useLibraryQuery } from "./StudioPanel";
import { useWorkspace } from "./Workspace";
import { BROWSE, panes } from "./workspace-state";
import { isStudioPath, syncThreadList } from "./bot/threadListSwitch";
import { studioSidebarModel, type SidebarItem } from "./studio-sidebar-model";

type Overview = { providers: ProviderView[]; items: CollectionItem[]; tags: TagView[]; views: SavedViewView[] };
const CLOSED_KEY = "studio.sidebar.closed";
const ROW = "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
const ACTIVE = "bg-state-active text-foreground";

/**
 * The provider's component. Shown off the Studio panel only by mistake (a
 * reload mid-switch, a second window): it switches the list for this page at
 * once and shows a quiet placeholder for that moment.
 */
export function StudioThreadList({ onNavigate }: PluginThreadListProps) {
  const sdk = useSdk();
  const pathname = usePathname();
  const here = isStudioPath(pathname);
  useEffect(() => { if (!here) void syncThreadList(sdk, pathname); }, [sdk, here, pathname]);
  if (!here) return <p className="px-3 py-2 text-xs text-muted-foreground">Loading threads…</p>;
  return <StudioItemsList onNavigate={onNavigate} />;
}

function useClosed(): [Set<string>, (id: string) => void] {
  const [closed, setClosed] = useState(() => {
    try { const raw = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]"); return new Set<string>(Array.isArray(raw) ? raw.filter((each): each is string => typeof each === "string") : []); } catch { return new Set<string>(); }
  });
  const toggle = (id: string) => setClosed((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
    return next;
  });
  return [closed, toggle];
}

function useSidebarData() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<{ overview: Overview; tabs: TabView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([rpc.call("overview", null), rpc.call("tabs", null)]).then(
      ([overview, { tabs }]) => { setData({ overview, tabs }); setError(null); },
      () => setError("Couldn't load Studio."),
    );
  }, [rpc]);
  useEffect(load, [load]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const soon = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 500); };
  useRealtime(STUDIO_REALTIME_CHANNEL, soon);
  useRealtime(TABS_CHANNEL, soon);
  return { data, error, rpc };
}

function Section({ id, label, closed, onToggle, children }: { id: string; label: string; closed: Set<string>; onToggle(id: string): void; children: ReactNode }) {
  const open = !closed.has(id);
  return (
    <section aria-label={label} className="mt-2">
      <button type="button" aria-expanded={open} onClick={() => onToggle(id)}
        className="group flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
      {open ? <div className="flex flex-col gap-px">{children}</div> : null}
    </section>
  );
}

function StudioItemsList({ onNavigate }: { onNavigate(): void }) {
  const { data, error, rpc } = useSidebarData();
  const context = useBbContext();
  const projects = useProjects();
  const workspace = useWorkspace();
  const query = useLibraryQuery();
  const [closed, toggle] = useClosed();
  const model = useMemo(() => data ? studioSidebarModel(data.overview, data.tabs, appliedKinds()?.off) : null, [data]);
  const active = panes(workspace.layout).find((pane) => pane.id === workspace.focused)?.active ?? null;
  const onLibrary = active === BROWSE.href;
  const filterSelected = (each: string) => onLibrary && query.trim() === each;
  const filter = (each: string) => { showLibrary(each); openAppPath("/plugins/studio/studio"); onNavigate(); };
  const open = (item: SidebarItem) => { openAppPath(item.href); onNavigate(); };
  const creatable = (data?.overview.providers ?? []).filter((provider) => provider.state === "ready")
    .flatMap((provider) => provider.kinds.filter((kind) => kind.create && model?.kinds.some((each) => each.pluginId === provider.pluginId && each.id === kind.id)).map((kind) => ({ provider, kind })));
  const projectId = context.projectId ?? projects[0]?.id ?? null;

  const itemRow = (item: SidebarItem) => {
    const selected = active !== null && canonicalPath(item.href) === active;
    return (
      <button key={item.key} type="button" data-testid="studio-sidebar-item" title={item.title || "Untitled"} aria-current={selected ? "page" : undefined}
        onClick={() => open(item)} className={`${ROW} ${selected ? ACTIVE : "text-foreground/90"}`}>
        {item.icon ? <span aria-hidden className="w-3.5 shrink-0 text-center text-xs leading-none">{item.icon}</span> : <Icon name={item.kindIcon || "File"} className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate">{item.title || "Untitled"}</span>
      </button>
    );
  };

  return (
    <nav aria-label="Studio" data-testid="studio-sidebar" className="studio-root flex flex-col px-1.5 pb-3">
      <div className="flex h-7 items-center gap-1 pl-2 text-[11px] font-medium text-muted-foreground">
        <span className="min-w-0 flex-1">Studio</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="New" title="New" data-testid="studio-sidebar-new" disabled={!creatable.length}
              className="flex size-6 items-center justify-center rounded-md hover:bg-state-hover hover:text-foreground disabled:opacity-40"><Icon name="Plus" className="size-3.5" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {creatable.map(({ provider, kind }) => (
              <DropdownMenuItem key={`${provider.pluginId}:${kind.id}`} onSelect={() => void createStudioItem(kind, {
                projectId,
                addOn: provider.name,
                create: async () => (await rpc.call("create", { pluginId: provider.pluginId, kind: kind.id, projectId })).item.href,
              })}>
                <Icon name={kind.icon} className="size-4" /> {kind.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!model ? <p className="px-2 text-xs text-muted-foreground">{error ?? "Loading…"}</p> : (
        <>
          <div className="flex flex-col gap-px" role="group" aria-label="Kinds">
            <button type="button" data-testid="studio-sidebar-kind" aria-current={filterSelected("") ? "page" : undefined} onClick={() => filter("")} className={`${ROW} ${filterSelected("") ? ACTIVE : ""}`}>
              <Icon name="GridView" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">All items</span>
            </button>
            {model.kinds.map((kind) => (
              <button key={`${kind.pluginId}:${kind.id}`} type="button" data-testid="studio-sidebar-kind" data-kind={kind.id} aria-current={filterSelected(kind.query) ? "page" : undefined}
                onClick={() => filter(kind.query)} className={`${ROW} ${filterSelected(kind.query) ? ACTIVE : ""}`}>
                <Icon name={kind.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{kind.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{kind.count}</span>
              </button>
            ))}
          </div>
          {model.views.length ? (
            <Section id="views" label="Saved views" closed={closed} onToggle={toggle}>
              {model.views.map((view) => (
                <button key={view.id} type="button" aria-current={filterSelected(view.query) ? "page" : undefined} onClick={() => filter(view.query)} className={`${ROW} ${filterSelected(view.query) ? ACTIVE : ""}`}>
                  <Icon name="Filter" className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{view.name}</span>
                </button>
              ))}
            </Section>
          ) : null}
          {model.tags.length ? (
            <Section id="tags" label="Tags" closed={closed} onToggle={toggle}>
              {model.tags.map((tag) => (
                <button key={tag.id} type="button" data-testid="studio-sidebar-tag" aria-current={filterSelected(tag.query) ? "page" : undefined} onClick={() => filter(tag.query)} className={`${ROW} ${filterSelected(tag.query) ? ACTIVE : ""}`}>
                  <span className="flex w-3.5 shrink-0 justify-center"><TagDot color={tag.color} /></span>
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{tag.count}</span>
                </button>
              ))}
            </Section>
          ) : null}
          {model.pinned.length ? <Section id="pinned" label="Pinned" closed={closed} onToggle={toggle}>{model.pinned.map(itemRow)}</Section> : null}
          {model.recent.length ? <Section id="recent" label="Recent" closed={closed} onToggle={toggle}>{model.recent.map(itemRow)}</Section> : null}
        </>
      )}
    </nav>
  );
}
