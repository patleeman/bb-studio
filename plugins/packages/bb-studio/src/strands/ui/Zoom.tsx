// Semantic zoom (design "Strands as shape", round 2, screens 7a–7b): one
// gesture zooms a conversation out in place. Level 0 is BB's own timeline;
// level 1, drawn here in the timeline's place (the fork's zoom seam), is one
// line per stretch of one strand. Pinch (ctrl+wheel), ⌃⌘− / ⌃⌘= or the
// header's Messages · Strands · Tree switch move between levels; the message
// in the middle of the screen stays put, clicking a line zooms back in to its
// key moment, and sending a message goes back to the messages. Where BB zooms,
// the header also carries what the strands box did: the strand filter, the
// Strands tab and "N need you". The tree (level 2) comes later.
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../kit/ui/utils";
import { useLive } from "../../ui/live";
import { flashReply } from "./ask-mark";
import { countsOf, replyAskOf, strayCountsOf } from "./model";
import { holdZoomable, keyboardModeOf, select, setKeyboardMode, setZoom, useKeyboardMode, useZoom, zoomInHost, zoomOf, ZOOM_MAX } from "./selection";
import { STRANDS_POLL_MS, useJump, useOpenStrandsTab, useStrandFilter } from "./Strip";
import { lineAt, nodeAt, nodeMatches, stepNode, timeRange, TREE_STEP, zoomLines, zoomTree, type TreeNode, type ZoomGlyph, type ZoomLine } from "./zoom-model";

export const TAGS_POLL_MS = 60_000;
/** Pinch distance (summed wheel deltaY) that moves one level. */
const PINCH_STEP = 60;
/** A pause this long between wheel events ends a pinch. */
const PINCH_PAUSE_MS = 350;
const LEVELS = ["Messages", "Strands", "Tree"] as const;
export const ZOOM_KEYS = "⌃⌘− ⌃⌘= · pinch · Esc Esc";
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

const LANE_DX = 26;
const laneX = (column: number) => 14 + column * LANE_DX;

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
  // Keyboard mode starts on the node in the middle, with the search focused.
  useEffect(() => {
    if (!keyboard) { setQuery(""); return; }
    setSelected((before) => before ?? anchor?.seq ?? tree.nodes.at(-1)?.seq ?? null);
    input.current?.focus();
  }, [keyboard, anchor, tree]);
  useEffect(() => {
    if (keyboard && chosen) listRef.current?.querySelector(`[data-zoom-node="${chosen.seq}"]`)?.scrollIntoView({ block: "nearest" });
  }, [keyboard, chosen]);
  const open = (node: TreeNode) => {
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
      if (chosen) open(chosen);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setKeyboardMode(threadId, false);
    }
  };
  const onQuery = (next: string) => {
    setQuery(next);
    // Typing keeps the choice on a match: the newest one when the chosen node no longer matches.
    if (chosen && nodeMatches(chosen, tree, next)) return;
    const matches = tree.nodes.filter((node) => nodeMatches(node, tree, next));
    setSelected(matches.at(-1)?.seq ?? selected);
  };
  if (!tree.nodes.length) {
    return <div className="studio-root px-6 py-10 text-center text-[12.5px] text-muted-foreground" data-zoom-view="">{tags.data ? "No strands sorted in this conversation yet." : "Loading strands…"}</div>;
  }
  const labelX = Math.max(176, laneX(tree.columns) + 24);
  const bottom = tree.height - 6;
  const laneMatches = (strandId: string) => !query || tree.nodes.some((node) => node.strandId === strandId && nodeMatches(node, tree, query));
  return (
    <div ref={listRef} data-zoom-view="2" className="studio-root mx-auto w-full max-w-[820px] px-4 py-3">
      {keyboard ? (
        <div className="sticky top-2 z-10 mb-2 flex items-center gap-3 rounded-xl border border-foreground/15 bg-background/95 px-3 py-2 text-[12px] text-muted-foreground shadow-sm" data-zoom-search="">
          <span aria-hidden>⌕</span>
          <input ref={input} value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={onKey}
            placeholder="Search the tree" aria-label="Search the tree"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70" />
          <span className="shrink-0 whitespace-nowrap text-[11px]">↑↓ move · ←→ other strand · Enter jump · Esc back</span>
        </div>
      ) : null}
      <svg width="100%" height={tree.height} className="block overflow-visible text-[12.5px]" data-zoom-tree="">
        <path d={`M${laneX(0)} 4V${bottom}`} className="fill-none stroke-foreground/25" strokeWidth={3} strokeLinecap="round" />
        {tree.gaps.map((gap) => <text key={`gap:${gap.y}`} x={labelX} y={gap.y} className="fill-muted-foreground/70 text-[11px]">{gap.hours} {gap.hours === 1 ? "hour" : "hours"} later</text>)}
        {tree.lanes.map((lane) => {
          const x = laneX(lane.column);
          const px = laneX(lane.parentColumn);
          const end = lane.endY ?? bottom;
          const y1 = lane.startY;
          const curve = `M${px} ${y1 - TREE_STEP}C${px} ${y1 - TREE_STEP * 0.3} ${x} ${y1 - TREE_STEP * 0.7} ${x} ${y1}L${x} ${end}`;
          return (
            <g key={lane.strandId} data-zoom-lane={lane.strandId} opacity={laneMatches(lane.strandId) ? 1 : 0.18}>
              <path d={curve} className={cn("fill-none", lane.done ? "stroke-foreground/25" : lane.current ? "stroke-foreground/85" : "stroke-foreground/40")} strokeWidth={lane.done ? 1.2 : lane.current ? 2.6 : 1.6} />
              {lane.endY !== null ? <circle cx={x} cy={lane.endY + 6} r={2.2} className="fill-foreground/35" /> : null}
            </g>
          );
        })}
        {tree.nodes.map((node) => {
          const x = laneX(node.column);
          const shown = nodeMatches(node, tree, query);
          const isChosen = keyboard && chosen?.seq === node.seq;
          return (
            <g key={node.seq} data-zoom-node={node.seq} data-zoom-seqs={String(node.turnSeq)} data-zoom-kind={node.kind} role="button" tabIndex={-1}
              onClick={() => open(node)} className="cursor-zoom-in [&:hover_text]:fill-foreground" opacity={shown ? 1 : 0.18}>
              <title>Zoom in here</title>
              {isChosen ? <rect data-zoom-chosen="" x={x - 12} y={node.y - 11} width={Math.max(320, labelX + 420 - x)} height={22} rx={6} className="fill-foreground/10 stroke-foreground/25" /> : null}
              <rect x={0} y={node.y - 9} width="100%" height={18} className="fill-transparent" />
              <NodeMark node={node} x={x} />
              <path d={`M${x + 8} ${node.y}H${labelX - 6}`} className="stroke-foreground/10" strokeDasharray="1 3" />
              <text x={labelX} y={node.y + 4} className={cn(node.kind === "open" || isChosen ? "fill-foreground" : "fill-muted-foreground")}>
                <tspan className="fill-muted-foreground/70 text-[11px]">{node.at === null ? "" : clockOf(node.at)}</tspan>
                {node.name ? <tspan className="fill-foreground font-semibold">{`  ${node.name}  `}</tspan> : "  "}
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const clockOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/u, "");

// ---- the header: Messages · Strands · Tree, "N need you", and the gestures ----

/**
 * In the conversation's header, where BB zooms and strands run: the strand
 * filter (chip, clear, previous and next), the zoom switch, the Strands tab
 * and "N need you". Nothing elsewhere: there the box above the composer shows them.
 */
export function ZoomSwitch({ threadId }: { threadId: string }) {
  const list = useLive("strands.list", { threadId }, { enabled: !!threadId, pollMs: STRANDS_POLL_MS });
  const level = useZoom(threadId);
  const zoomTo = useZoomTo(threadId);
  const jump = useJump(threadId);
  const openTab = useOpenStrandsTab();
  const enabled = !!list.data?.enabled && zoomInHost();
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
  useEscEsc(threadId, enabled);
  if (!enabled) return null;
  const needs = countsOf(list.data).needs + strayCountsOf(list.data).needs;
  const waiting = list.data?.strands.find((strand) => strand.state === "needs-you") ?? null;
  // To what waits on the user: a strand's ask, else (only stray workers wait) the Strands tab, which lists them.
  const goToAsk = () => {
    const reply = waiting ? replyAskOf(waiting) : null;
    const seq = reply?.seq ?? waiting?.latestSeq ?? null;
    if (seq == null) { openTab(); return; }
    if (reply) flashReply(threadId, reply.seq);
    if (zoomOf(threadId) > 0) zoomTo(0, seq); else jump(seq);
  };
  return (
    <span className="studio-root inline-flex min-w-0 shrink items-center gap-2" data-zoom-switch="">
      <StrandFilterChip threadId={threadId} />
      <span role="group" aria-label="Zoom" title={`Zoom: ${ZOOM_KEYS}`} className="inline-flex shrink-0 rounded-lg bg-foreground/5 p-0.5">
        {LEVELS.map((label, index) => (
          <button key={label} type="button" data-zoom-level={index} aria-pressed={level === index} disabled={index > ZOOM_MAX}
            title={index > ZOOM_MAX ? "Coming soon" : `${label} (${ZOOM_KEYS})`}
            onClick={() => zoomTo(index)}
            className={cn("cursor-pointer rounded-md px-2 py-0.5 text-[11.5px] text-muted-foreground disabled:cursor-default disabled:opacity-40",
              level === index && "bg-foreground/10 text-foreground")}>
            {label}
          </button>
        ))}
      </span>
      <button type="button" data-zoom-strands-tab="" onClick={openTab} title="Every strand, its asks and workers"
        className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-[11.5px] text-muted-foreground hover:bg-accent/50 hover:text-foreground">
        All strands
      </button>
      {needs > 0 ? (
        <button type="button" data-zoom-needs="" onClick={goToAsk}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-[11.5px] font-medium text-warning hover:bg-warning/15">
          <span aria-hidden className="size-1.5 rounded-full bg-warning" />{needs} need you
        </button>
      ) : null}
    </span>
  );
}

/** The strand the conversation is filtered to: its name, clear, its message count, and previous and next (Esc clears too). */
function StrandFilterChip({ threadId }: { threadId: string }) {
  const { filtered, seqs, step } = useStrandFilter(threadId);
  if (!filtered) return null;
  const count = seqs.length || filtered.messages;
  return (
    <span data-strand-filter={filtered.id} className="inline-flex min-w-0 max-w-[260px] items-center gap-1 rounded-md border border-foreground/25 bg-accent px-1.5 py-0.5 text-[11.5px]">
      <span className="truncate font-medium text-foreground">{filtered.title}</span>
      <button type="button" aria-label="Clear filter" onClick={() => select(threadId, null)} className="grid size-4 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:text-foreground">×</button>
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">{count} {count === 1 ? "message" : "messages"}</span>
      <button type="button" aria-label="Previous message in this strand" onClick={() => step(-1)} className="shrink-0 cursor-pointer rounded px-0.5 text-muted-foreground hover:text-foreground">↑</button>
      <button type="button" aria-label="Next message in this strand" onClick={() => step(1)} className="shrink-0 cursor-pointer rounded px-0.5 text-muted-foreground hover:text-foreground">↓</button>
    </span>
  );
}

/** Two presses of Esc this close together open keyboard mode. */
const ESC_ESC_MS = 450;

/**
 * Esc Esc (like Pi's tree) opens keyboard mode: the tree, with the search
 * focused. Only presses nothing else handled count.
 */
function useEscEsc(threadId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let last = Number.NEGATIVE_INFINITY;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat || event.defaultPrevented || keyboardModeOf(threadId)) return;
      const now = event.timeStamp;
      if (now - last > ESC_ESC_MS) { last = now; return; }
      last = Number.NEGATIVE_INFINITY;
      // From Strands, the tree opens on the line that was in the middle; from the messages, BB gives the anchor.
      const level = zoomOf(threadId);
      if (level > 0 && level < ZOOM_MAX) levelAnchors.set(threadId, middles.get(threadId)?.() ?? null);
      else if (level === 0) levelAnchors.delete(threadId);
      setKeyboardMode(threadId, true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, threadId]);
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
