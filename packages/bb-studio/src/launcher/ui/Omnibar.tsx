import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { rpcContract } from "../../contract";
import { errorMessage } from "../../kit/format";
import { cn, Icon } from "../../kit/ui/index";
import { shownKind, type NewTabEntry } from "../../newtab";
import { openedTabs } from "../../ui/opened-tabs";
import { BotFace } from "../../presence/ui/BotFace";
import type { RunnableEntry } from "../commands";
import { omnibarDocuments, type SearchHit } from "../documents";
import { launcherKey, launcherRows, QUICK_PICKS, sectionLabelAt, sectionStarts, type LauncherRow, type OmnibarMode } from "../rank";

const SEARCH_DELAY_MS = 120;
const SEARCH_LIMIT = 12;
const ENTITY_LIMIT = 40;
const drag = { WebkitAppRegion: "drag" } as CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

export interface OmnibarRun {
  shift: boolean;
  alternate: boolean;
}

export interface OmnibarProps {
  host: "launcher" | "palette";
  mode: OmnibarMode;
  entries: readonly RunnableEntry[];
  botName: string | null;
  botId?: string | null;
  threadId: string | null;
  onRun(row: LauncherRow, how: OmnibarRun): Promise<void>;
  onClose(): void;
  onEscape?(handler: () => boolean): () => void;
}

interface Found { query: string; entries: readonly NewTabEntry[]; hits: readonly SearchHit[] }

function useDocuments(typed: string, threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [recents, setRecents] = useState<readonly NewTabEntry[]>([]);
  const [found, setFound] = useState<Found>({ query: "", entries: [], hits: [] });
  useEffect(() => {
    let live = true;
    void rpc.call("newtab_recents", { threadId }).then((answer) => { if (live) setRecents(answer?.entries ?? []); }, () => {});
    return () => { live = false; };
  }, [rpc, threadId]);
  useEffect(() => {
    if (!typed) return;
    let live = true;
    const query = typed.slice(0, 200);
    const timer = setTimeout(() => {
      void Promise.all([
        rpc.call("newtab_search", { query, threadId, limit: ENTITY_LIMIT }).then((answer) => answer?.entries ?? [], () => []),
        rpc.call("searchAll", { query, limit: SEARCH_LIMIT }).then((answer) => (answer ?? []) as SearchHit[], () => []),
      ]).then(([entries, hits]) => { if (live) setFound({ query: typed, entries, hits }); });
    }, SEARCH_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [rpc, typed, threadId]);
  return useMemo(() => {
    const current = typed !== "" && found.query === typed;
    return omnibarDocuments({ recents, opened: openedTabs(), entries: typed ? found.entries : [], hits: typed ? found.hits : [], searched: current });
  }, [recents, found, typed]);
}

function RowIcon({ icon }: { icon: string }) {
  return /^[\w/-]+$/.test(icon) ? <Icon name={icon} className="size-4 shrink-0 text-muted-foreground" /> : <span aria-hidden className="w-4 shrink-0 text-center text-sm leading-none">{icon}</span>;
}

function rowDetail(row: LauncherRow): string | null {
  if (row.type === "document") return shownKind(row.document) || null;
  if (row.type === "entry") return row.entry.detail ?? null;
  return null;
}

export function Omnibar({ host, mode, entries, botName, botId = null, threadId, onRun, onClose, onEscape }: OmnibarProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const typed = query.trim();
  const documents = useDocuments(typed, threadId);
  const rows = useMemo(() => launcherRows({ query: typed, mode, entries, documents, botName }), [typed, mode, entries, documents, botName]);
  const starts = useMemo(() => sectionStarts(rows), [rows]);
  useEffect(() => { setSelected(0); }, [typed]);
  const at = Math.min(selected, Math.max(0, rows.length - 1));
  useEffect(() => { list.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView?.({ block: "nearest" }); }, [at]);
  const launcher = host === "launcher";
  const searchMode = mode === "search";
  const clearsOnEscape = launcher || onEscape !== undefined;
  useEffect(() => onEscape?.(() => {
    if (!query) return false;
    setQuery("");
    return true;
  }), [onEscape, query]);

  const run = async (row: LauncherRow | undefined, how: OmnibarRun) => {
    if (!row || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRun(row, how);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    const action = launcherKey(event, { selected: at, count: rows.length, query, starts, escape: launcher });
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.type === "move") setSelected(action.to);
    else if (action.type === "run") void run(rows[action.index], { shift: action.shift, alternate: action.alternate });
    else if (action.type === "clear") setQuery("");
    else onClose();
  };

  const current = rows[at];
  const label = searchMode ? "Search conversations and files" : "Search apps, commands, conversations and files";
  const placeholder = botName ? `${searchMode ? "Search" : "Search or run a command"}, or ask ${botName}…` : `${label}…`;
  const hints = current?.type === "ask" ? ["↵ to send", "⇧↵ in a new conversation"] : current?.type === "document" && !launcher ? ["↵ to open", "⌘↵ in a split"] : ["↵ to run"];
  return (
    <div data-studio-launcher="" data-omnibar-host={host} onKeyDown={onKeyDown}
      className={cn("box-border flex w-full flex-col overflow-hidden bg-background text-sm text-foreground", launcher ? "h-dvh border border-border" : "max-h-[min(36rem,72vh)]")}>
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-4" style={launcher ? drag : undefined}>
        <Icon name="Search" className="size-4 shrink-0 text-muted-foreground" />
        <input autoFocus role="combobox" aria-expanded aria-controls={`studio-${host}-list`} aria-activedescendant={rows.length ? `studio-${host}-${at}` : undefined} aria-label={label}
          placeholder={placeholder} style={launcher ? noDrag : undefined}
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" value={query} onChange={(event) => setQuery(event.target.value)} />
        {busy ? <span className="shrink-0 text-xs text-muted-foreground">Working…</span> : null}
      </div>
      <div ref={list} id={`studio-${host}-list`} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rows.map((row, index) => {
          const heading = sectionLabelAt(rows, index, typed !== "");
          const detail = rowDetail(row);
          const shortcut = row.type === "entry" ? row.entry.shortcut : undefined;
          return (
            <div key={row.key}>
              {heading ? <p data-testid="launcher-section" className="m-0 px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">{heading}</p> : null}
              <div id={`studio-${host}-${index}`} data-index={index} data-testid="launcher-row" data-row-type={row.type} role="option" aria-selected={index === at}
                className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2", index === at && "bg-state-hover")} onMouseMove={() => setSelected(index)}
                onClick={(event) => void run(row, { shift: event.shiftKey, alternate: event.metaKey || event.ctrlKey })}>
                {row.type === "ask" && botId ? <BotFace botId={botId} size={16} /> : <RowIcon icon={row.icon} />}
                <span data-testid="launcher-title" className="min-w-0 flex-1 truncate">{row.title}</span>
                {detail ? <span className="shrink-0 text-xs text-muted-foreground">{detail}</span> : null}
                {shortcut ? <kbd className="shrink-0 font-sans text-xs text-muted-foreground">{shortcut}</kbd> : null}
                {index < QUICK_PICKS ? <kbd data-testid="launcher-pick" className="shrink-0 font-sans text-xs text-muted-foreground">⌘{index + 1}</kbd> : null}
              </div>
            </div>
          );
        })}
        {!rows.length ? <p data-testid="launcher-empty" className="m-0 px-3 py-3 text-muted-foreground">{typed ? "No matches." : "Nothing to show yet."}</p> : null}
      </div>
      {error ? <p role="alert" data-testid="launcher-error" className="m-0 shrink-0 border-t border-border px-4 py-2 text-xs text-destructive">{error}</p> : null}
      <div className="flex shrink-0 gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span>↑↓ to move</span>{starts.length > 1 ? <span>tab to jump</span> : null}{hints.map((hint) => <span key={hint}>{hint}</span>)}<span>⌘1–9 to pick</span>
        {clearsOnEscape ? <span>esc to {query ? "clear" : "close"}</span> : <span>esc to close</span>}
      </div>
    </div>
  );
}
