// What the address bar opens (⌘T): one box to go anywhere or start anything.
// It lists, in order: actions that match, your open tabs, threads, then
// everything else in the Space (pages, bots, channels, the Library and its
// views, archived tabs) from office_search. Picking something that isn't a
// tab opens it, and opening adds it to Today.
import * as Dialog from "@radix-ui/react-dialog";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { Icon, openAppPath, studioPath } from "@bb-studio/kit/app";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useCall } from "./model";
import { openOffice } from "./routes";
import { TabGlyph, openTab } from "./TabRow";
import { shownTab, threadRef, type ShownTab, type Tab } from "./tabs";
import { PORTAL_SCOPE, cn } from "./styles";

const OPEN_EVENT = "bb-studio:office-command-bar";
const DEBOUNCE_MS = 120;
const LIMIT = 8;

type Mode = "all" | "archived";

/** Opens the bar from anywhere: the address bar, New tab, ⌘T, the archive button. */
export function openCommandBar(mode: Mode = "all"): void {
  globalThis.dispatchEvent?.(new CustomEvent(OPEN_EVENT, { detail: mode }));
}

interface Row {
  key: string;
  group: string;
  glyph: ReactNode;
  label: string;
  detail?: string;
  run: () => void;
}

const asShown = shownTab;

function matches(text: string, query: string): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const hay = text.toLocaleLowerCase();
  return words.every((word) => hay.includes(word));
}

function IconGlyph({ name }: { name: string }) {
  return <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center text-subtle-foreground [&_svg]:size-4"><Icon name={name} /></span>;
}

export function CommandBar({ spaceId, tabs }: { spaceId: string | null; tabs: readonly ShownTab[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("all");
  useEffect(() => {
    const onOpen = (event: Event) => { setMode((event as CustomEvent<Mode>).detail ?? "all"); setOpen(true); };
    globalThis.addEventListener?.(OPEN_EVENT, onOpen);
    return () => globalThis.removeEventListener?.(OPEN_EVENT, onOpen);
  }, []);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay {...PORTAL_SCOPE} className="fixed inset-0 z-50 bg-black/30 motion-safe:animate-in motion-safe:fade-in" />
        <Dialog.Content
          {...PORTAL_SCOPE}
          aria-describedby={undefined}
          className="fixed top-[14vh] left-1/2 z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none"
        >
          <Dialog.Title className="sr-only">{mode === "archived" ? "Archived tabs" : "Search or open"}</Dialog.Title>
          {open ? <Bar spaceId={spaceId} tabs={tabs} mode={mode} onDone={() => setOpen(false)} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Bar({ spaceId, tabs, mode, onDone }: { spaceId: string | null; tabs: readonly ShownTab[]; mode: Mode; onDone: () => void }) {
  const call = useCall();
  const threadActions = useSidebarThreadActions();
  const navigate = useBbNavigate();
  const { threads } = useSidebarThreads();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Tab[]>([]);
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  // Server results: everything in the Space, or archived tabs in archive mode.
  useEffect(() => {
    if (!spaceId) return;
    if (mode === "all" && !query.trim()) { setFound([]); return; }
    let live = true;
    const timer = setTimeout(() => {
      const request = mode === "archived"
        ? call("tabs_archived", { spaceId, query: query.trim() || undefined, limit: 30 }).then((result) => (result as { tabs: Tab[] }).tabs)
        : call("office_search", { spaceId, query: query.trim(), limit: 20 }).then((result) => (result as { results: Tab[] }).results);
      request.then((rows) => { if (live) setFound(rows); }, () => { if (live) setFound([]); });
    }, DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [call, spaceId, mode, query]);

  const rows = useMemo<Row[]>(() => {
    const go = (tab: ShownTab, split = false) => () => { onDone(); openTab(tab, threadActions, { split }); };
    if (mode === "archived") {
      return found.map((tab) => ({ key: tab.ref, group: "Archived tabs", glyph: <TabGlyph tab={asShown(tab)} />, label: tab.title || "Untitled", detail: tab.itemKind ?? tab.kind, run: go(asShown(tab)) }));
    }
    const q = query.trim();
    const actions: Row[] = [
      { key: "new-thread", group: "Actions", glyph: <IconGlyph name="MessageSquarePlus" />, label: q ? `New thread: “${q}”` : "New thread", run: () => { onDone(); navigate.toCompose({ focusPrompt: true, ...(q ? { initialPrompt: q } : {}) }); } },
      { key: "inbox", group: "Actions", glyph: <IconGlyph name="studio/inbox" />, label: "Inbox", run: () => { onDone(); openOffice("inbox"); } },
      { key: "home", group: "Actions", glyph: <IconGlyph name="studio/home" />, label: "Home", run: () => { onDone(); openOffice(""); } },
      { key: "library", group: "Actions", glyph: <IconGlyph name="Layers" />, label: "Library", run: () => { onDone(); openAppPath(studioPath(), { main: true }); } },
      { key: "archived", group: "Actions", glyph: <IconGlyph name="Archive" />, label: "Archived tabs", run: () => { onDone(); setTimeout(() => openCommandBar("archived"), 0); } },
      { key: "add-bot", group: "Actions", glyph: <IconGlyph name="UserPlus" />, label: "Add a bot", run: () => { onDone(); openOffice("team/new"); } },
      { key: "settings", group: "Actions", glyph: <IconGlyph name="SlidersHorizontal" />, label: "Space settings", run: () => { onDone(); openOffice("settings"); } },
    ].filter((row) => !q || row.key === "new-thread" || matches(row.label, q));
    if (!q) {
      // Empty box: actions, then the tabs you have, most recent first.
      const recent = [...tabs].sort((a, b) => b.openedAt - a.openedAt).slice(0, LIMIT);
      return [...actions, ...recent.map((tab) => ({ key: tab.ref, group: "Tabs", glyph: <TabGlyph tab={tab} />, label: tab.title, run: go(tab) }))];
    }
    const openRefs = new Set(tabs.map((tab) => tab.ref));
    const tabRows = tabs.filter((tab) => matches(tab.title, q)).slice(0, LIMIT)
      .map((tab) => ({ key: tab.ref, group: "Tabs", glyph: <TabGlyph tab={tab} />, label: tab.title, run: go(tab) }));
    // Threads that aren't tabs: open ones by title right away, then BB's
    // search (titles and messages, archived threads too) as it answers.
    const listed = threads.filter((thread) => !openRefs.has(threadRef(thread.id)) && matches(thread.displayTitle, q)).slice(0, LIMIT)
      .map((thread) => ({
        key: threadRef(thread.id),
        group: "Threads",
        glyph: <IconGlyph name="MessageSquare" />,
        label: thread.displayTitle,
        run: () => { onDone(); threadActions.open(thread.id); },
      }));
    const listedRefs = new Set(listed.map((row) => row.key));
    const searched = found.filter((tab) => tab.kind === "thread" && !openRefs.has(tab.ref) && !listedRefs.has(tab.ref)).map((tab) => ({
      key: tab.ref,
      group: "Threads",
      glyph: <IconGlyph name="MessageSquare" />,
      label: tab.title || "Untitled",
      detail: tab.itemKind === "archived" ? "archived" : undefined,
      run: go(asShown(tab)),
    }));
    const threadRows = [...listed, ...searched];
    const more = found.filter((tab) => tab.kind !== "thread" && !openRefs.has(tab.ref)).map((tab) => ({
      key: tab.ref,
      group: "In this space",
      glyph: <TabGlyph tab={asShown(tab)} />,
      label: tab.title || "Untitled",
      detail: tab.zone === "archived" && tab.archivedAt ? "archived tab" : tab.itemKind ?? (tab.kind === "bot" ? "bot" : tab.kind === "conversation" ? "channel" : tab.kind),
      run: go(asShown(tab)),
    }));
    // A real match comes before the actions; "New thread: …" stays as the fallback.
    return [...tabRows, ...threadRows, ...more, ...actions];
  }, [mode, query, found, tabs, threads, threadActions, navigate, onDone]);

  useEffect(() => { setSelected(0); }, [query, mode]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setSelected((index) => Math.min(index + 1, rows.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelected((index) => Math.max(index - 1, 0)); }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[selected];
      if (!row) return;
      row.run();
    }
  };

  let lastGroup = "";
  return (
    <div>
      <div className="flex items-center gap-2.5 border-b border-border px-4">
        <Icon name={mode === "archived" ? "Archive" : "Search"} aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(change) => setQuery(change.target.value)}
          onKeyDown={onKey}
          placeholder={mode === "archived" ? "Search archived tabs…" : "Search, open, or start a thread…"}
          aria-label={mode === "archived" ? "Search archived tabs" : "Search or open"}
          aria-controls="office-command-results"
          aria-activedescendant={rows[selected] ? `office-command-${selected}` : undefined}
          className="h-13 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle-foreground"
        />
      </div>
      <div ref={list} id="office-command-results" role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
        {rows.length === 0
          ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">{mode === "archived" ? "No archived tabs." : "Nothing found."}</p>
          : rows.map((row, index) => {
              const header = row.group !== lastGroup ? row.group : null;
              lastGroup = row.group;
              return (
                <div key={`${row.group}:${row.key}`}>
                  {header ? <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-subtle-foreground">{header}</div> : null}
                  <button
                    type="button"
                    id={`office-command-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === selected}
                    onMouseMove={() => setSelected(index)}
                    onClick={row.run}
                    className={cn("flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm", index === selected && "bg-state-hover")}
                  >
                    {row.glyph}
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    {row.detail ? <span className="shrink-0 text-xs text-subtle-foreground">{row.detail}</span> : null}
                  </button>
                </div>
              );
            })}
      </div>
    </div>
  );
}
