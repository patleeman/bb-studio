import { createStudioItem, Icon, ItemTile, cn, openAppPath, projectName, threadLinkId, useProjects } from "../kit/app/index";
import { useStudioOpen } from "./studio-open";
import { untitled } from "../kit/format";
import { mentionPrompt } from "../kit/contract";
import { Dialog, DialogContent, DialogTitle } from "../kit/ui/index";
import { useBbContext, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ProviderView, rpcContract } from "../contract";
import { QUICK_OPEN_EVENT } from "../ids";
import { useSearchEscape } from "../kit/ui/search-escape";
import { SearchFreshness, useSearchFreshness } from "./SearchFreshness";
import { highlightParts } from "../kit/search-match";
import { ITEM_FAMILIES, typeOfKind } from "../item-model";

type Result = { ref: { pluginId: string; id: string }; kind: string; title: string; snippet: { text: string; ranges: { start: number; end: number }[] }; href: string; projectId: string | null; updatedAt: number; score: number };
type Row = { type: "result"; hit: Result } | { type: "command"; label: string; run: () => void };
const DEBOUNCE_MS = 150;

/**
 * Whether a provider kind is where "New <kind>" goes: the kind itself, or one
 * that replaces it (Setup → Kinds). Studio offers create on only one of them.
 */
function makes(each: { id: string; replaces?: string; capabilities?: { create: boolean } }, kind: string): boolean {
  return (each.id === kind || each.replaces === kind) && Boolean(each.capabilities?.create);
}

const APPS = ITEM_FAMILIES.find((family) => family.id === "app")!.plural;

export function resultGroup(pluginId: string, kind: string, plural: string | undefined): { key: string; label: string } {
  if (typeOfKind(pluginId, kind)?.family === "app") return { key: "app", label: APPS };
  return { key: kind, label: plural ?? (kind === "thread" ? "Threads" : kind) };
}

export function QuickOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen((current) => !current);
    window.addEventListener(QUICK_OPEN_EVENT, toggle);
    return () => window.removeEventListener(QUICK_OPEN_EVENT, toggle);
  }, []);
  return open ? <QuickOpenDialog onClose={() => setOpen(false)} /> : null;
}

export function toggleQuickOpen() { window.dispatchEvent(new Event(QUICK_OPEN_EVENT)); }

/** A snippet with what the query matches in bold, by the one rule every Studio search marks with (kit/search-match). */
function Marked({ text, query }: { text: string; query: string }) {
  return <>{highlightParts(text, query).map((part, index) => part.match ? <mark key={index} className="bg-transparent font-semibold text-foreground">{part.text}</mark> : part.text)}</>;
}

function QuickOpenDialog({ onClose }: { onClose: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  // Search floats over everything, so what it opens goes to the container the
  // main view shows: over a thread, its workbench; in Studio, a tab. Mod
  // opens it in the other place (src/ui/studio-open.tsx).
  const open = useStudioOpen("route");
  const freshness = useSearchFreshness();
  const navigate = useBbNavigate();
  const context = useBbContext();
  const projects = useProjects();
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [query, setQuery] = useState("");
  const [threadOnly, setThreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [returnFocus] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    let live = true;
    let lastFocused: HTMLElement | null = null;
    // Host editors can consume bubbling focus events before Radix sees them.
    // Capture the request, then repair focus after the host finishes handling it.
    const containFocus = (event: FocusEvent) => {
      const panel = dialog.current;
      if (!panel || !(event.target instanceof HTMLElement)) return;
      if (panel.contains(event.target)) { lastFocused = event.target; return; }
      queueMicrotask(() => {
        if (!live || !panel.isConnected || panel.contains(document.activeElement)) return;
        const otherDialog = document.activeElement?.closest('[role="dialog"], [role="alertdialog"]');
        if (otherDialog && !otherDialog.contains(panel) && !otherDialog.closest('[hidden], [aria-hidden="true"], [inert]')) return;
        const target = lastFocused?.isConnected && panel.contains(lastFocused)
          ? lastFocused : panel.querySelector<HTMLElement>('[role="combobox"]');
        target?.focus({ preventScroll: true });
      });
    };
    document.addEventListener("focusin", containFocus, true);
    return () => { live = false; document.removeEventListener("focusin", containFocus, true); };
  }, []);

  useEffect(() => {
    rpc.call("overview", null).then(({ providers }) => setProviders(providers), () => {});
  }, [rpc]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => rpc.call("searchAll", { query: query.trim(), ...(threadOnly ? { kinds: ["thread"] } : {}), limit: 40 }).then(
      (hits) => { if (live) { setResults(hits); setError(null); setLoading(false); } },
      (cause: unknown) => { if (live) { setError(cause instanceof Error ? cause.message : "Search failed."); setLoading(false); } },
    ), query ? DEBOUNCE_MS : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [rpc, query, threadOnly, freshness.revision]);

  const kinds = useMemo(() => new Map(providers.flatMap((provider) => provider.kinds.map((kind) => [`${provider.pluginId}:${kind.id}`, kind]))), [providers]);
  const commands = useMemo(() => {
    const create = (kind: string, label: string): Row => ({ type: "command", label, run: () => {
      const provider = providers.find((entry) => entry.state === "ready" && entry.kinds.some((each) => makes(each, kind)));
      if (!provider) return;
      const target = provider.kinds.find((each) => makes(each, kind));
      if (!target) return;
      const projectId = context.projectId ?? null;
      onClose();
      void createStudioItem(target, {
        projectId,
        addOn: provider.name,
        create: async () => (await rpc.call("create", { pluginId: provider.pluginId, kind: target.id, projectId })).item.href,
        open: (href) => open({ href }),
      });
    } });
    return [
      ...([ ["page", "New page"], ["recording", "New recording"], ["task", "New task"] ] as const)
        .filter(([kind]) => providers.some((provider) => provider.state === "ready" && provider.kinds.some((each) => makes(each, kind))))
        .map(([kind, label]) => create(kind, label)),
      { type: "command", label: "Open Studio", run: () => { onClose(); openAppPath("/plugins/studio/studio"); } },
      { type: "command", label: "Hand to agent", run: () => { onClose(); navigate.toCompose({ initialPrompt: results[0] ? mentionPrompt([results[0]]) : "", focusPrompt: true }); } },
      { type: "command", label: "Go to thread", run: () => { setThreadOnly(true); setQuery(""); } },
    ] satisfies Row[];
  }, [providers, rpc, navigate, context.projectId, onClose, results, open]);
  const visibleCommands = commands.filter((row) => row.type === "command" && (!query || row.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const groupOf = (hit: Result) => resultGroup(hit.ref.pluginId, hit.kind, kinds.get(`${hit.ref.pluginId}:${hit.kind}`)?.plural);
  const rows: Row[] = [...[...results].sort((a, b) => groupOf(a).key.localeCompare(groupOf(b).key) || b.score - a.score).map((hit): Row => ({ type: "result", hit })), ...visibleCommands];
  useEffect(() => setSelected(0), [query]);
  useEffect(() => setSelected((index) => Math.min(index, Math.max(0, rows.length - 1))), [rows.length]);
  useEffect(() => { list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const alternateFor = (event: { metaKey: boolean; ctrlKey: boolean }) => event.metaKey || event.ctrlKey;
  const activate = (row: Row | undefined, alternate = false) => {
    if (!row) return;
    if (row.type === "command") return row.run();
    onClose();
    const threadId = threadLinkId(row.hit.href);
    if (threadId) open({ threadId, title: untitled(row.hit.title) }, { alternate });
    else open({ href: row.hit.href, title: untitled(row.hit.title), ...(kinds.get(`${row.hit.ref.pluginId}:${row.hit.kind}`)?.icon ? { icon: kinds.get(`${row.hit.ref.pluginId}:${row.hit.kind}`)!.icon } : {}) }, { alternate });
  };
  // Escape clears what is typed before it closes the dialog.
  const searchField = useSearchEscape(query, () => setQuery(""));
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") setSelected((at) => rows.length ? (at + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length : 0);
    else if (event.key === "Enter") activate(rows[selected], alternateFor(event));
    else if (event.key === "Escape") onClose();
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  let lastKind = "";
  return <Dialog open onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent ref={dialog} hideCloseButton aria-describedby={undefined} className="studio-quick-open flex max-h-[min(38rem,78vh)] w-full max-w-xl flex-col gap-0 overflow-hidden rounded-lg border border-border bg-background p-0 shadow-2xl sm:top-[12vh] sm:translate-y-0"
      onCloseAutoFocus={(event) => event.preventDefault()}
      onAfterCloseAutoFocus={() => { if (returnFocus?.isConnected) returnFocus.focus(); }}>
      <DialogTitle className="sr-only">Search Studio</DialogTitle>
      <div className="flex items-center gap-2.5 border-b border-border px-4"><Icon name="Search" className="size-4 shrink-0 text-muted-foreground" />
        <input ref={searchField} autoFocus role="combobox" aria-expanded aria-controls="studio-quick-open-list" aria-activedescendant={rows.length ? `studio-quick-open-${selected}` : undefined} aria-label="Search Studio" placeholder={threadOnly ? "Search threads…" : "Search Studio and threads…"} className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} />
        {loading ? <span className="text-xs text-muted-foreground">Searching…</span> : null}
        <button type="button" aria-label="Close search" className="flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring" onClick={onClose}><Icon name="X" className="size-4" /></button>
      </div>
      <SearchFreshness {...freshness} />
      <div ref={list} id="studio-quick-open-list" role="listbox" aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rows.map((row, index) => {
          const kind = row.type === "result" ? row.hit.kind : "command";
          const heading = row.type === "result" ? groupOf(row.hit) : { key: "command", label: "Commands" };
          const group = heading.key !== lastKind; lastKind = heading.key;
          const info = row.type === "result" ? kinds.get(`${row.hit.ref.pluginId}:${kind}`) : null;
          return <div key={row.type === "result" ? `${row.hit.ref.pluginId}:${row.hit.ref.id}` : row.label}>
            {group ? <p className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">{!query && row.type === "result" ? "Recently changed" : heading.label}</p> : null}
            <div id={`studio-quick-open-${index}`} data-index={index} role="option" aria-selected={index === selected} className={cn("studio-quick-open-row flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2", index === selected && "bg-state-hover")} onMouseMove={() => setSelected(index)} onClick={(event) => activate(row, alternateFor(event))}>
              {row.type === "result" ? <><ItemTile icon={null} kindIcon={info?.icon ?? (kind === "thread" ? "MessageSquare" : "File")} size="md" /><div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><span className="truncate text-sm font-medium">{untitled(row.hit.title)}</span><span className="shrink-0 text-xs text-muted-foreground">{info?.label ?? kind}{row.hit.projectId ? ` · ${projectName(projects, row.hit.projectId)}` : ""}</span></div>{row.hit.snippet.text ? <p className="studio-quick-open-snippet truncate text-xs text-muted-foreground"><Marked text={row.hit.snippet.text} query={query} /></p> : null}</div></> : <><Icon name="CornerDownRight" className="size-4 text-muted-foreground" /><span className="text-sm">{row.label}</span></>}
            </div>
          </div>;
        })}
        {error ? <p className="px-3 py-4 text-sm text-destructive">{error}</p> : null}
        {!loading && !results.length && query && !error ? <p className="px-3 py-3 text-sm text-muted-foreground">{freshness.status?.state === "current" && !freshness.error ? "No matches." : "No matches in the available results."}</p> : null}
      </div>
      <div className="flex gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground"><span>↑↓ to move</span><span>↵ to open</span><span>⌘↵ in a split</span><span>esc to close</span></div>
    </DialogContent>
  </Dialog>;
}
