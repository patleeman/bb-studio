// Semantic zoom (design "Strands as shape", round 2, screens 7a–7b): one
// gesture zooms a conversation out in place. Level 0 is BB's own timeline;
// level 1, drawn here in the timeline's place (the fork's zoom seam), is one
// line per stretch of one strand. Pinch (ctrl+wheel), ⌃⌘− / ⌃⌘= or the
// header's Messages · Strands · Tree switch move between levels; the message
// in the middle of the screen stays put, clicking a line zooms back in to its
// key moment, and sending a message goes back to the messages. Where BB zooms,
// the header also carries what the strands box did: the strand filter, the
// Strands tab and "N need you". Tree (level 2) draws the strands as branches;
// Esc Esc opens keyboard mode on it.
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../kit/ui/utils";
import type { StrandList } from "../contract";
import { useLive } from "../../ui/live";
import { flashReply } from "./ask-mark";
import { holdZoomable, keyboardModeOf, select, selectionOf, setKeyboardMode, setZoom, useKeyboardMode, useZoom, zoomInHost, zoomOf, ZOOM_MAX } from "./selection";
import { STRANDS_POLL_MS, useJump, useOpenStrandsTab, useStrandFilter } from "./Strip";
import { lineAt, nodeAt, stepNode, timeRange, TREE_STEP, treeMatches, zoomLines, zoomTree, type TreeNode, type TreeNodeKind, type ZoomGlyph, type ZoomLine } from "./zoom-model";

export const TAGS_POLL_MS = 60_000;
/** Pinch distance (summed wheel deltaY) that moves one level. */
const PINCH_STEP = 60;
/** A pause this long between wheel events ends a pinch. */
const PINCH_PAUSE_MS = 350;
const LEVELS = ["Messages", "Strands", "Tree"] as const;
export const ZOOM_KEYS = "⌃⌘− ⌃⌘= · pinch · Esc Esc";
/**
 * BB's thread header is the window's drag strip in the desktop app: what Studio
 * puts there must carve itself out, as BB's own header buttons do
 * (MACOS_WINDOW_NO_DRAG_CLASS), or every click drags the window instead. The
 * class names are the host's own; the inline style holds even where the host's
 * CSS lacks them.
 */
export const NO_DRAG_CLASS = "relative z-50 [app-region:no-drag] [-webkit-app-region:no-drag]";
export const NO_DRAG_STYLE = { appRegion: "no-drag", WebkitAppRegion: "no-drag", position: "relative", zIndex: 50 } as CSSProperties;

/** Pinching over these zooms them, not the conversation. */
const OWN_ZOOM = "img, canvas, iframe, video, [data-zoomable]";

// ---- zooming, per conversation ----

interface ZoomActions { zoomBy(delta: number): void }
const actions = new Map<string, ZoomActions>();

/** Zooms conversation `threadId` by `delta` levels (from a command); false when it isn't on screen. */
export function zoomThreadBy(threadId: string | null, delta: number): boolean {
  const zoom = threadId ? actions.get(threadId) : undefined;
  if (!zoom) return false;
  zoom.zoomBy(delta);
  return true;
}

export const canZoom = (threadId: string | null) => !!threadId && actions.has(threadId);

/** Zoomed out, each conversation's drawn list or tree answers the message in its middle (its own DOM, no lookup by id). */
const middles = new Map<string, () => number | null>();
/** Between Strands and Tree, the message that was in the middle (BB gives the anchor only when leaving the messages). */
const levelAnchors = new Map<string, number | null>();

export function resetZoomForTests(): void {
  actions.clear();
  middles.clear();
  levelAnchors.clear();
  returnFocus.clear();
}

/** The line nearest the middle of `list`'s scroll viewport, as the message to land on. */
function middleOfList(list: HTMLElement | null): number | null {
  const lines = [...(list?.querySelectorAll<HTMLElement>("[data-zoom-line],[data-zoom-node]") ?? [])];
  if (!lines.length) return null;
  const viewport = lines[0]!.closest("[data-page-scroll-viewport]");
  const box = viewport?.getBoundingClientRect();
  const middle = box ? box.top + box.height / 2 : window.innerHeight / 2;
  let best: HTMLElement | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const rect = line.getBoundingClientRect();
    const away = Math.abs((rect.top + rect.bottom) / 2 - middle);
    if (away < distance) { distance = away; best = line; }
  }
  const seqs = (best?.dataset.zoomSeqs ?? "").split(" ").map(Number).filter(Number.isFinite);
  return seqs.length ? seqs[Math.floor(seqs.length / 2)]! : null;
}

/** Moves a conversation between levels; zooming in to messages lands on `seq` (else the line in the middle). */
function useZoomTo(threadId: string) {
  const jump = useJump(threadId);
  return useCallback((level: number, seq?: number | null) => {
    const from = zoomOf(threadId);
    const to = Math.max(0, Math.min(ZOOM_MAX, level));
    if (to === from) return;
    const middle = from > 0 ? middles.get(threadId)?.() ?? null : null;
    const land = to === 0 ? seq ?? middle : null;
    if (from > 0 && to > 0) levelAnchors.set(threadId, seq ?? middle); else levelAnchors.delete(threadId);
    setZoom(threadId, to);
    if (land !== null) jump(land);
  }, [jump, threadId]);
}

// ---- level 1: one line per stretch of one strand ----

const glyphPath: Record<ZoomGlyph, ReactNode> = {
  fork: <><path d="M4 0V16" /><path d="M4 3L12 11V16" data-strong="" /></>,
  cont: <path d="M5 0V16" />,
  end: <><path d="M5 0V9" /><circle cx="5" cy="11" r="2.2" data-dot="" /></>,
  trunk: <><path d="M5 0V16" strokeDasharray="2 2" /><circle cx="5" cy="8" r="2" data-dot="" /></>,
};

function Glyph({ glyph, current }: { glyph: ZoomGlyph; current: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden data-glyph={glyph}
      className={cn("size-4 shrink-0 fill-none stroke-foreground/50 [&_[data-dot]]:fill-foreground/60 [&_[data-dot]]:stroke-none [&_[data-strong]]:stroke-foreground/85", current && "stroke-foreground/90")}
      strokeWidth={current ? 2.2 : 1.6}>
      {glyphPath[glyph]}
    </svg>
  );
}

/** BB's `zoom.View`: what a zoomed-out conversation shows in the timeline's place. A crash goes back to the messages. */
export function ZoomView(props: { threadId: string; level: number; anchorSeq: number | null; latestUserSeq?: number | null }) {
  const anchorSeq = levelAnchors.has(props.threadId) ? levelAnchors.get(props.threadId)! : props.anchorSeq;
  return (
    <ZoomCrashGuard threadId={props.threadId}>
      {props.level >= 2 ? <TreeView key="tree" {...props} anchorSeq={anchorSeq} /> : <ZoomList key="list" {...props} anchorSeq={anchorSeq} />}
    </ZoomCrashGuard>
  );
}

/**
 * What both zoomed-out views do: gestures and keys zoom in to the message in
 * the middle of `listRef`, and the user sending a message goes back to the
 * messages (the first value seen, rows arriving on a cold open, is the
 * baseline, not a send).
 */
function useZoomedOut(threadId: string, listRef: { readonly current: HTMLElement | null }, latestUserSeq: number | null) {
  useEffect(() => {
    const own = () => middleOfList(listRef.current);
    middles.set(threadId, own);
    return () => { if (middles.get(threadId) === own) middles.delete(threadId); };
  }, [threadId, listRef]);
  const sentFrom = useRef(latestUserSeq);
  useEffect(() => {
    if (latestUserSeq !== null && sentFrom.current !== null && latestUserSeq !== sentFrom.current) setZoom(threadId, 0);
    if (latestUserSeq !== null) sentFrom.current = latestUserSeq;
  }, [latestUserSeq, threadId]);
}

/** A list that throws sets the conversation back to level 0, so the switch and BB agree on Messages. */
class ZoomCrashGuard extends Component<{ threadId: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(error: unknown): void {
    console.warn("[studio] the strands view failed; back to the messages", error);
    setZoom(this.props.threadId, 0);
  }
  override render(): ReactNode { return this.state.failed ? null : this.props.children; }
}

function ZoomList({ threadId, anchorSeq, latestUserSeq = null }: { threadId: string; level: number; anchorSeq: number | null; latestUserSeq?: number | null }) {
  const tags = useLive("strands.tags", { threadId }, { pollMs: TAGS_POLL_MS });
  const rows = useMemo(() => zoomLines(tags.data), [tags.data]);
  const zoomTo = useZoomTo(threadId);
  const anchor = lineAt(rows, anchorSeq);
  const anchored = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  // The message that was in the middle stays in the middle: its line, once the lines are known
  // (again on the next frame, after the scroll body settles on its new content).
  useLayoutEffect(() => {
    if (anchored.current || !anchor) return;
    anchored.current = true;
    const centre = () => listRef.current?.querySelector(`[data-zoom-key="${anchor.key}"]`)?.scrollIntoView({ block: "center" });
    centre();
    const frame = requestAnimationFrame(centre);
    return () => cancelAnimationFrame(frame);
  }, [anchor]);
  useZoomedOut(threadId, listRef, latestUserSeq);
  const open = (line: ZoomLine) => {
    if (line.mark === "open") flashReply(threadId, line.go);
    zoomTo(0, line.go);
  };
  if (!rows.length) {
    return <div className="studio-root px-6 py-10 text-center text-[12.5px] text-muted-foreground" data-zoom-view="">{tags.data ? "No strands sorted in this conversation yet." : "Loading strands…"}</div>;
  }
  return (
    <div ref={listRef} data-zoom-view="1" className="studio-root mx-auto w-full max-w-[780px] px-4 py-3">
      {rows.map((row) => row.kind === "gap" ? (
        <div key={row.key} className="py-2.5 text-center text-[11.5px] text-muted-foreground/70">{row.hours} {row.hours === 1 ? "hour" : "hours"} later</div>
      ) : (
        <button key={row.key} type="button" data-zoom-line="" data-zoom-key={row.key} data-zoom-seqs={row.seqs.join(" ")} data-zoom-mark={row.mark ?? undefined}
          onClick={() => open(row)} title="Zoom in here"
          className={cn("flex w-full min-w-0 cursor-zoom-in items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent/40",
            row.mark === "open" && "bg-warning/10 hover:bg-warning/15",
            anchor?.key === row.key && "ring-1 ring-foreground/10")}>
          <Glyph glyph={row.glyph} current={row.current} />
          <span className={cn("shrink-0 whitespace-nowrap", row.glyph === "end" ? "text-muted-foreground" : "font-medium text-foreground")}>{row.name}</span>
          <span className="min-w-[14px] shrink-0 text-[11.5px] text-muted-foreground/70">{row.count}</span>
          <span className={cn("min-w-0 flex-1 truncate", row.mark === "open" && "text-foreground")}>
            {row.mark === "open" ? <i aria-label="Needs you" className="mr-1.5 inline-block size-2 rounded-full bg-warning align-[0px]" />
              : row.mark === "ask" ? <i aria-label="Asked you" className="mr-1.5 inline-block size-2 rounded-full border-[1.5px] border-warning align-[0px]" /> : null}
            {row.moment}
          </span>
          <span className="shrink-0 whitespace-nowrap text-[11.5px] text-muted-foreground/70">{timeRange(row.from, row.to)}</span>
        </button>
      ))}
    </div>
  );
}

// ---- level 2: the tree (7c), and keyboard mode (7e) ----


/** What a node looks like: the open ask filled amber, an ask an amber ring, your message ◆, a result □. */
function NodeMark({ node, x }: { node: TreeNode; x: number }) {
  const y = node.y;
  switch (node.kind) {
    case "open": return <><circle cx={x} cy={y} r={10} className="fill-warning/20" /><circle cx={x} cy={y} r={6} className="fill-warning" /></>;
    case "ask": return <circle cx={x} cy={y} r={4.5} className="fill-background stroke-warning" strokeWidth={1.6} />;
    case "dec": return <path d={`M${x} ${y - 5}l5 5l-5 5l-5-5z`} className="fill-foreground" />;
    default: return <rect x={x - 4.5} y={y - 4.5} width={9} height={9} rx={2} className="fill-background stroke-foreground/80" strokeWidth={1.5} />;
  }
}

/** Level 2: the strands as branches on one vertical time axis, nodes only for your messages, asks and results. */
function TreeView({ threadId, anchorSeq, latestUserSeq = null }: { threadId: string; level: number; anchorSeq: number | null; latestUserSeq?: number | null }) {
  const tags = useLive("strands.tags", { threadId }, { pollMs: TAGS_POLL_MS });
  const tree = useMemo(() => zoomTree(tags.data), [tags.data]);
  const zoomTo = useZoomTo(threadId);
  const keyboard = useKeyboardMode(threadId);
  const listRef = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const anchor = nodeAt(tree, anchorSeq);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => treeMatches(tree, query), [tree, query]);
  useZoomedOut(threadId, listRef, latestUserSeq);
  const chosen = tree.nodes.find((node) => node.seq === selected) ?? null;
  // The node of the message that was in the middle stays in the middle (again after the scroll body settles).
  const anchored = useRef(false);
  useLayoutEffect(() => {
    if (anchored.current || !anchor) return;
    anchored.current = true;
    const centre = () => listRef.current?.querySelector(`[data-zoom-node="${anchor.seq}"]`)?.scrollIntoView({ block: "center" });
    centre();
    const frame = requestAnimationFrame(centre);
    return () => cancelAnimationFrame(frame);
  }, [anchor]);
  // Keyboard mode starts on the node in the middle with the search focused: once, when it opens (not on every update).
  const start = useRef<number | null>(null);
  start.current = anchor?.seq ?? tree.nodes.at(-1)?.seq ?? null;
  useEffect(() => {
    if (!keyboard) { setQuery(""); return; }
    setSelected((before) => before ?? start.current);
    if (paneFocused(listRef.current)) input.current?.focus();
  }, [keyboard]);
  useEffect(() => {
    if (keyboard && chosen) listRef.current?.querySelector(`[data-zoom-node="${chosen.seq}"]`)?.scrollIntoView({ block: "nearest" });
  }, [keyboard, chosen]);
  const open = (node: TreeNode) => {
    // A node the strand filter hides: clear the filter first, so the jump shows it.
    const filter = selectionOf(threadId);
    if (filter && filter.strandId !== node.strandId) select(threadId, null);
    if (node.kind === "open") flashReply(threadId, node.seq);
    zoomTo(0, node.seq);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const move = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[event.key as "ArrowUp"];
    if (move) {
      event.preventDefault();
      setSelected(stepNode(tree, chosen, move, query)?.seq ?? null);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (chosen && (!matches || matches.seqs.has(chosen.seq))) open(chosen);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      leaveKeyboardMode(threadId, true);
    }
  };
  // Leaving the search for somewhere outside the tree (the composer, another pane) leaves keyboard mode.
  const onBlur = (event: FocusEvent<HTMLInputElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && listRef.current?.contains(next)) return;
    leaveKeyboardMode(threadId, false);
  };
  const onQuery = (next: string) => {
    setQuery(next);
    // Typing keeps the choice on a match: the newest one when the chosen node no longer matches; none when nothing does.
    const now = treeMatches(tree, next);
    if (!now || (chosen && now.seqs.has(chosen.seq))) return;
    setSelected(tree.nodes.filter((node) => now.seqs.has(node.seq)).at(-1)?.seq ?? null);
  };
  if (!tree.nodes.length) {
    return <div className="studio-root px-6 py-10 text-center text-[12.5px] text-muted-foreground" data-zoom-view="">{tags.data ? "No strands sorted in this conversation yet." : "Loading strands…"}</div>;
  }
  // Lanes draw closer together as strands grow, so the labels stay in the column.
  const dx = Math.max(8, Math.min(26, 180 / tree.columns));
  const laneX = (column: number) => 14 + column * dx;
  const labelX = Math.max(176, laneX(tree.columns) + 24);
  const bottom = tree.height - 6;
  const ids = `zoom-tree-${threadId}`;
  const nodeId = (seq: number) => `${ids}-node-${seq}`;
  return (
    <div ref={listRef} data-zoom-view="2" className="studio-root mx-auto w-full max-w-[820px] px-4 py-3">
      {keyboard ? (
        <div className="sticky top-2 z-10 mb-2 flex items-center gap-3 rounded-xl border border-foreground/15 bg-background/95 px-3 py-2 text-[12px] text-muted-foreground shadow-sm" data-zoom-search="">
          <span aria-hidden>⌕</span>
          <input ref={input} value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={onKey} onBlur={onBlur}
            placeholder="Search the tree" aria-label="Search the tree" role="combobox" aria-expanded="true"
            aria-controls={`${ids}-list`} aria-activedescendant={chosen ? nodeId(chosen.seq) : undefined} aria-describedby={`${ids}-keys`}
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70" />
          <span id={`${ids}-keys`} className="shrink-0 whitespace-nowrap text-[11px]">↑↓ move · ←→ other strand · Enter jump · Esc back</span>
        </div>
      ) : null}
      <svg id={`${ids}-list`} role="listbox" aria-label="Strand tree" width="100%" height={tree.height} className="block overflow-visible text-[12.5px]" data-zoom-tree="">
        <path d={`M${laneX(0)} 4V${bottom}`} className="fill-none stroke-foreground/25" strokeWidth={3} strokeLinecap="round" />
        {tree.gaps.map((gap) => <text key={`gap:${gap.y}`} x={labelX} y={gap.y} className="fill-muted-foreground/70 text-[11px]">{gap.hours} {gap.hours === 1 ? "hour" : "hours"} later</text>)}
        {tree.lanes.map((lane) => {
          const x = laneX(lane.column);
          const px = laneX(lane.parentColumn);
          const end = lane.endY ?? bottom;
          const y1 = lane.startY;
          const curve = `M${px} ${y1 - TREE_STEP}C${px} ${y1 - TREE_STEP * 0.3} ${x} ${y1 - TREE_STEP * 0.7} ${x} ${y1}L${x} ${end}`;
          return (
            <g key={lane.strandId} data-zoom-lane={lane.strandId} opacity={!matches || matches.strands.has(lane.strandId) ? 1 : 0.18}>
              <path d={curve} className={cn("fill-none", lane.done ? "stroke-foreground/25" : lane.current ? "stroke-foreground/85" : "stroke-foreground/40")} strokeWidth={lane.done ? 1.2 : lane.current ? 2.6 : 1.6} />
              {lane.endY !== null ? <circle cx={x} cy={lane.endY + 6} r={2.2} className="fill-foreground/35" /> : null}
            </g>
          );
        })}
        {tree.nodes.map((node) => {
          const x = laneX(node.column);
          const shown = !matches || matches.seqs.has(node.seq);
          const isChosen = keyboard && chosen?.seq === node.seq;
          const time = node.at === null ? "" : clockOf(node.at);
          const strand = node.strandId ? tree.names.get(node.strandId) ?? "" : "";
          return (
            <g key={node.seq} id={nodeId(node.seq)} data-zoom-node={node.seq} data-zoom-seqs={String(node.seq)} data-zoom-kind={node.kind}
              role="option" aria-selected={isChosen} aria-label={[KIND_LABEL[node.kind], time, strand, node.text].filter(Boolean).join(", ")} tabIndex={-1}
              onClick={() => open(node)} className="cursor-zoom-in [&:hover_text]:fill-foreground" opacity={shown ? 1 : 0.18}>
              {isChosen ? <rect data-zoom-chosen="" x={x - 12} y={node.y - 11} width={Math.max(320, labelX + 420 - x)} height={22} rx={6} className="fill-foreground/10 stroke-foreground/25" /> : null}
              <rect x={0} y={node.y - 9} width="100%" height={18} className="fill-transparent" />
              <NodeMark node={node} x={x} />
              <path d={`M${x + 8} ${node.y}H${labelX - 6}`} className="stroke-foreground/10" strokeDasharray="1 3" />
              <text x={labelX} y={node.y + 4} direction="ltr" className={cn(node.kind === "open" || isChosen ? "fill-foreground" : "fill-muted-foreground")}>
                <tspan className="fill-muted-foreground/70 text-[11px]">{time}</tspan>
                {node.name ? <tspan dx={8} className="fill-foreground font-semibold">{isolate(node.name)}</tspan> : null}
                <tspan dx={8}>{isolate(node.label)}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const KIND_LABEL: Record<TreeNodeKind, string> = { open: "Needs you", ask: "Asked you", dec: "Your message", res: "Result" };

/** First-strong isolation: a right-to-left name or line never reorders the time around it. */
const isolate = (text: string) => `⁨${text}⁩`;

/** "9:05 AM": the time with its marker, so a day-long thread isn't ambiguous. */
const clockOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * Whether `element` is in the focused split pane. A pane says data-focused
 * "true" or "false" only while the window is split; a lone pane carries the
 * id without it, and counts as focused.
 */
function paneFocused(element: Element | null): boolean {
  const pane = element?.closest<HTMLElement>("[data-split-pane-id]");
  return !pane || pane.dataset.focused !== "false";
}

/** What had focus when keyboard mode opened, per conversation: Esc gives it back. */
const returnFocus = new Map<string, HTMLElement | null>();

/** Leaves keyboard mode (staying on the tree); with `restore`, focus goes back where it was when it opened. */
function leaveKeyboardMode(threadId: string, restore: boolean) {
  if (!keyboardModeOf(threadId)) return;
  const back = returnFocus.get(threadId);
  returnFocus.delete(threadId);
  setKeyboardMode(threadId, false);
  if (restore && back?.isConnected) back.focus();
}

// ---- the header: Messages · Strands · Tree, and the gestures ----

/**
 * In the conversation's header, where BB zooms and strands run: the strand
 * filter (chip, clear, previous and next), the zoom switch and the Strands
 * tab. Nothing elsewhere: there the box above the composer shows them.
 */
export function ZoomSwitch({ threadId, botConversation = false }: { threadId: string; /** A Bot's conversation: show the controls (disabled) even with its strands off. */ botConversation?: boolean }) {
  const list = useLive("strands.list", { threadId }, { enabled: !!threadId, pollMs: STRANDS_POLL_MS });
  const level = useZoom(threadId);
  const zoomTo = useZoomTo(threadId);
  const openTab = useOpenStrandsTab();
  const reason = zoomBlocked(list.data, zoomInHost(), botConversation);
  const enabled = reason === "";
  const zoomBy = useCallback((delta: number) => zoomTo(zoomOf(threadId) + delta), [threadId, zoomTo]);
  // Before paint: coming back to a zoomed-out conversation draws the list at once, not the timeline first.
  useLayoutEffect(() => {
    if (!enabled) return;
    const own: ZoomActions = { zoomBy };
    actions.set(threadId, own);
    const release = holdZoomable(threadId);
    return () => {
      if (actions.get(threadId) === own) actions.delete(threadId);
      release();
    };
  }, [enabled, threadId, zoomBy]);
  usePinch(threadId, enabled, zoomBy);
  const own = useRef<HTMLSpanElement>(null);
  useEscEsc(threadId, enabled, own);
  if (reason === null) return null;
  const iconButton = "grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <span ref={own} className={cn("studio-root inline-flex min-w-0 shrink items-center justify-end gap-1.5", NO_DRAG_CLASS)} style={NO_DRAG_STYLE} data-zoom-switch="" data-zoom-blocked={enabled ? undefined : reason}>
      {enabled ? <StrandFilterChip threadId={threadId} /> : null}
      <span role="group" aria-label="Zoom" className="inline-flex shrink-0 items-center rounded-lg bg-foreground/5 p-0.5">
        {LEVELS.map((label, index) => (
          <button key={label} type="button" data-zoom-level={index} aria-pressed={enabled && level === index} aria-label={label} disabled={!enabled} style={NO_DRAG_STYLE}
            title={enabled ? `${label}: ${LEVEL_HINTS[index]}` : `${label}: ${reason}`}
            onClick={() => zoomTo(index)}
            className={cn(iconButton, "size-[22px]", enabled && level === index && "bg-foreground/10 text-foreground")}>
            <LevelIcon level={index} />
          </button>
        ))}
      </span>
      {enabled ? (
        <button type="button" data-zoom-strands-tab="" onClick={openTab} style={NO_DRAG_STYLE} aria-label="All strands" title="All strands: every strand, its asks and workers"
          className={iconButton}>
          <ListIcon />
        </button>
      ) : null}
    </span>
  );
}

/** What each level's button says, with its keys. */
const LEVEL_HINTS = [
  "every message (⌃⌘= or pinch out)",
  "one line per stretch of a strand (⌃⌘− or pinch in)",
  "the strands as branches (⌃⌘− again, or Esc Esc to search it)",
];

/**
 * Why a conversation can't zoom, shown on its disabled controls; "" when it
 * can, null when nothing should show (strands are off and it isn't a Bot's
 * conversation, or the strands haven't loaded).
 */
export function zoomBlocked(list: StrandList | null | undefined, hostZooms: boolean, botConversation: boolean): string | null {
  if (!list) return null;
  if (!list.enabled) return botConversation ? "strands are off for this conversation." : null;
  if (!hostZooms) return "this version of BB can't zoom a conversation out; update the app to 1.0.14 or later.";
  if (!list.strands.length && !list.earlier.length) return "no messages are sorted into strands yet.";
  return "";
}

function LevelIcon({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-[14px] fill-none stroke-current" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {level === 0 ? <path d="M3 3.5h10v6.5H7.5L4.5 12.5V10H3z" />
        : level === 1 ? <><path d="M3 4h10" /><path d="M3 8h7" /><path d="M3 12h9" /></>
          : <><path d="M4.5 2.5v11" /><path d="M4.5 5.5c0 2.5 6 1.5 6 4.5v3.5" /><circle cx="4.5" cy="13.5" r="0.6" /></>}
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-[14px] fill-none stroke-current" strokeWidth={1.5} strokeLinecap="round">
      <path d="M6 4h7.5" /><path d="M6 8h7.5" /><path d="M6 12h7.5" />
      <circle cx="3" cy="4" r="0.7" /><circle cx="3" cy="8" r="0.7" /><circle cx="3" cy="12" r="0.7" />
    </svg>
  );
}

/** The strand the conversation is filtered to, compact: its name, previous and next, and clear (Esc clears too). */
function StrandFilterChip({ threadId }: { threadId: string }) {
  const { filtered, seqs, step } = useStrandFilter(threadId);
  if (!filtered) return null;
  const count = seqs.length || filtered.messages;
  return (
    <span data-strand-filter={filtered.id} style={NO_DRAG_STYLE} title={`Showing only ${filtered.title}: ${count} ${count === 1 ? "message" : "messages"} (Esc clears)`}
      className="inline-flex h-6 min-w-0 max-w-[200px] items-center gap-0.5 rounded-md border border-foreground/20 bg-accent pl-1.5 text-[11.5px]">
      <span className="truncate font-medium text-foreground">{filtered.title}</span>
      <span className="shrink-0 px-0.5 text-muted-foreground">{count}</span>
      <button type="button" aria-label="Previous message in this strand" onClick={() => step(-1)} className="shrink-0 cursor-pointer rounded px-0.5 text-muted-foreground hover:text-foreground">↑</button>
      <button type="button" aria-label="Next message in this strand" onClick={() => step(1)} className="shrink-0 cursor-pointer rounded px-0.5 text-muted-foreground hover:text-foreground">↓</button>
      <button type="button" aria-label="Clear filter" onClick={() => select(threadId, null)} className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:text-foreground">×</button>
    </span>
  );
}

/** Two presses of Esc this close together open keyboard mode. */
const ESC_ESC_MS = 450;

/**
 * Esc Esc (like Pi's tree) opens keyboard mode: the tree, with the search
 * focused. Only in the focused split pane, and only presses nothing else
 * handled count, decided after the whole dispatch (so handlers on window, a
 * lightbox or a panel closing, count too). An Esc in a text field other than
 * the composer doesn't count. The composer's own Esc only blurs it: that one
 * counts. In keyboard mode, an Esc nothing handled leaves it.
 */
function useEscEsc(threadId: string, enabled: boolean, own: { readonly current: HTMLElement | null }) {
  useEffect(() => {
    if (!enabled) return;
    let last = Number.NEGATIVE_INFINITY;
    // The composer whose Esc was the first press: it has blurred by the second, and Esc gives focus back to it.
    let firstFrom: HTMLElement | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat || !paneFocused(own.current)) return;
      // Never take an Esc that closes something: a menu, a popup, the slash or mention menu, a dictation.
      if (escapeHasWork()) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editor = target?.closest(COMPOSER) ?? null;
      if (target && !editor && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) return;
      const draft = editor?.textContent ?? null;
      const at = event.timeStamp;
      const timer = setTimeout(() => {
        timers.delete(timer);
        // The composer's Esc only blurs it: that counts as the first press, when it left the draft as it was.
        if (editor && editor.textContent !== draft) return;
        const handled = event.defaultPrevented && !(editor && !document.activeElement?.closest(COMPOSER));
        if (handled) return;
        if (keyboardModeOf(threadId)) { leaveKeyboardMode(threadId, true); return; }
        if (at - last > ESC_ESC_MS) { last = at; firstFrom = editor ? target : null; return; }
        last = Number.NEGATIVE_INFINITY;
        // From Strands, the tree opens on the line that was in the middle; from the messages, BB gives the anchor.
        const level = zoomOf(threadId);
        if (level > 0 && level < ZOOM_MAX) levelAnchors.set(threadId, middles.get(threadId)?.() ?? null);
        else if (level === 0) levelAnchors.delete(threadId);
        const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
        returnFocus.set(threadId, active ?? firstFrom ?? target);
        firstFrom = null;
        setKeyboardMode(threadId, true);
      }, 0);
      timers.add(timer);
    };
    // Capture: the draft and any open menu are read before anything handles the Esc; the decision waits for the dispatch.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [enabled, threadId, own]);
}

/** BB's composer (its editor), whose Esc only blurs it. */
const COMPOSER = "[data-promptbox-editor-content]";

/** Something an Esc would close or stop: an open menu or popup, the composer's slash or mention menu, a dictation. */
const ESCAPE_WORK = [
  "[data-radix-popper-content-wrapper]",
  "[data-bb-portaled-overlay]",
  '[role="menu"]',
  '[role="dialog"]',
  `${COMPOSER} [aria-expanded="true"]`,
  'button[aria-label="Cancel recording"]',
  'button[aria-label="Cancel transcription"]',
].join(",");

function escapeHasWork(doc: Document = document): boolean {
  for (const element of doc.querySelectorAll<HTMLElement>(ESCAPE_WORK)) {
    // Open popups are mounted only while open, so being there is enough.
    if (!element.closest("[data-zoom-tree],[data-zoom-switch]")) return true;
  }
  return false;
}

/**
 * Trackpad pinch over the conversation (wheel events with ctrlKey): pinching
 * in zooms out. It listens in the bubble phase and leaves alone what something
 * else handled or zooms itself (an image, a canvas, a frame), and takes the
 * event only when the pinch's direction can still move the level.
 */
function usePinch(threadId: string, enabled: boolean, zoomBy: (delta: number) => void) {
  const zoom = useRef(zoomBy);
  zoom.current = zoomBy;
  useEffect(() => {
    if (!enabled) return;
    let sum = 0;
    let last = 0;
    let spent = false;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.defaultPrevented || !(event.target instanceof Element)) return;
      if (event.target.closest("[data-timeline-zoom-thread]")?.getAttribute("data-timeline-zoom-thread") !== threadId) return;
      if (event.target.closest(OWN_ZOOM)) return;
      const out = event.deltaY > 0;
      const level = zoomOf(threadId);
      if (out ? level >= ZOOM_MAX : level <= 0) return;
      event.preventDefault();
      // One pinch moves one level: a pause starts the next.
      if (event.timeStamp - last > PINCH_PAUSE_MS) { sum = 0; spent = false; }
      last = event.timeStamp;
      if (spent) return;
      sum += event.deltaY;
      if (Math.abs(sum) < PINCH_STEP) return;
      spent = true;
      zoom.current(sum > 0 ? 1 : -1);
    };
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, [enabled, threadId]);
}
