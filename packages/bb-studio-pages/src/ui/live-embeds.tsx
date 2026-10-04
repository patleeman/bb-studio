// Embeds that stay live: a table edited in place, a recording played with its
// transcript. Each reads and writes its add-on
// through Pages and refreshes while it's shown.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, cn } from "@bb-studio/kit/ui";
import { parseTableSubPath, tableHref, tableSubPath, type Table } from "@bb-studio/kit/tables";
import { TableView, type TableHost } from "@bb-studio/kit/table-grid";
import { toast } from "sonner";
import type { RecordingCard, StudioEmbedItem } from "../contract";
import { usePagesUi } from "./context";
import { useStudioItems } from "./studio-embeds";

const POLL_MS = 5_000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Loads a value and reloads it every few seconds while the page is visible. */
function useLive<T>(load: () => Promise<T>, key: string): { value: T | undefined; failed: boolean; reload(): void } {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(() => {
    void loadRef.current().then(
      (next) => {
        setValue(next);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(() => {
    setValue(undefined);
    reload();
    const timer = setInterval(() => document.visibilityState === "visible" && reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [key, reload]);
  return { value, failed, reload };
}

// ---- Tables ----

/** A table edited in place; `target` is `<table id>` or `<table id>/view/<view id>`. */
export function TableEmbed({ target, onTargetChange }: { target: string; onTargetChange?(target: string): void }) {
  const ui = usePagesUi();
  const linked = parseTableSubPath(target);
  const tableId = linked?.tableId ?? "";
  const { value: table, failed } = useLive<Table | null>(() => ui.table(tableId), tableId);
  const items = useStudioItems();
  const api = useMemo(() => ui.tableApi(tableId), [ui, tableId]);
  const host = useMemo<TableHost>(
    () => ({
      openUrl: ui.openUrl,
      openItem: (relation) => {
        const item = items?.find((each) => each.pluginId === relation.pluginId && each.id === relation.itemId);
        if (item) ui.openPath(item.href);
      },
      items: (items ?? []).map((item: StudioEmbedItem) => ({
        pluginId: item.pluginId,
        itemId: item.id,
        title: item.title,
        kindLabel: item.kindLabel,
        kindIcon: item.kindIcon,
        icon: item.icon,
        href: item.href,
      })),
      bots: ui.bots.map((bot) => bot.name),
      copyLink: ({ viewId, rowId }) =>
        void navigator.clipboard.writeText(new URL(tableHref({ tableId, viewId, rowId }), window.location.origin).href).then(
          () => toast.success(rowId ? "Copied a link to the row." : viewId ? "Copied a link to the view." : "Copied a link to the table."),
          (error) => toast.error(message(error)),
        ),
      onError: (error) => toast.error(message(error)),
    }),
    [ui, items, tableId],
  );

  if (!table) {
    return (
      <p role={failed || table === null ? "alert" : "status"} className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
        <Icon name="Rows2" className="size-4" />
        {table === null ? "This table was deleted." : failed ? "Studio Tables isn't available." : "Loading table…"}
      </p>
    );
  }
  return (
    <div className="pages-table-embed">
      <header className="flex items-center gap-2 px-3 pt-2.5">
        <Icon name="Rows2" className="size-4 shrink-0 text-muted-foreground" />
        <button
          type="button"
          className="min-w-0 truncate text-sm font-medium text-foreground hover:underline"
          title="Open in Tables"
          onClick={() => ui.openPath(tableHref({ tableId, viewId: linked?.viewId }))}
        >
          {table.title}
        </button>
        <button
          type="button"
          aria-label="Open in Tables"
          className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => ui.openPath(tableHref({ tableId, viewId: linked?.viewId }))}
        >
          <Icon name="ArrowUpRight" className="size-4" />
        </button>
      </header>
      <TableView
        embedded
        table={table}
        api={api}
        host={host}
        viewId={linked?.viewId}
        onViewChange={onTargetChange ? (viewId) => onTargetChange(tableSubPath({ tableId, viewId })) : undefined}
      />
    </div>
  );
}

// ---- Recordings ----

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const rest = `${String(Math.floor((seconds % 3600) / 60)).padStart(hours ? 2 : 1, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${rest}` : rest;
}

const EXCERPT = 4;

/** A recording's player, notes and transcript; each line plays from where it was said. */
export function RecordingBody({ id }: { id: string }) {
  const ui = usePagesUi();
  const { value: recording } = useLive<RecordingCard | null>(() => ui.recording(id), id);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [paused, setPaused] = useState(true);
  const [expanded, setExpanded] = useState(false);
  if (!recording) return null;
  const { segments } = recording;
  const play = (index: number) => {
    const element = audio.current;
    const segment = segments[index];
    if (!element || !segment) {
      setPlaying(null);
      return;
    }
    if (playing !== index) element.src = segment.url;
    setPlaying(index);
    void element.play().catch((error) => toast.error(message(error)));
  };
  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (playing === null) play(0);
    else if (element.paused) void element.play();
    else element.pause();
  };
  const shown = expanded ? segments : segments.slice(0, EXCERPT);
  return (
    <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5 text-sm">
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => (playing !== null && playing + 1 < segments.length ? play(playing + 1) : setPlaying(null))}
      />
      {segments.length ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={paused ? "Play" : "Pause"}
            className="flex size-8 items-center justify-center rounded-full bg-foreground text-background hover:opacity-90"
            onClick={toggle}
          >
            <Icon name={paused ? "Play" : "Pause"} className="size-4" />
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {playing === null ? clock(recording.durationMs) : `${clock(segments[playing]!.offsetMs)} / ${clock(recording.durationMs)}`}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{recording.status === "done" ? "Nothing was transcribed." : "Transcribing…"}</p>
      )}
      {recording.summary ? <p className="text-sm leading-relaxed text-foreground">{recording.summary}</p> : null}
      {recording.decisions.length ? (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {recording.decisions.slice(0, 5).map((decision) => (
            <li key={decision}>{decision}</li>
          ))}
        </ul>
      ) : null}
      {shown.length ? (
        <ol className={cn("flex flex-col gap-0.5", expanded && "max-h-72 overflow-y-auto")}>
          {shown.map((segment, index) => (
            <li key={segment.id}>
              <button
                type="button"
                className={cn("flex w-full gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-state-hover", playing === index && "bg-primary/10")}
                onClick={() => play(index)}
              >
                <span className="w-10 shrink-0 text-muted-foreground tabular-nums">{clock(segment.offsetMs)}</span>
                <span className={cn("min-w-0 flex-1 text-foreground", !expanded && "line-clamp-2")}>{segment.text}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {segments.length > EXCERPT ? (
        <button type="button" className="self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Show less" : `Show full transcript (${segments.length} parts)`}
        </button>
      ) : null}
    </div>
  );
}
