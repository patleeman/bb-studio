// The board in an organic look (looks.ts): items at their natural height,
// placed by organic.ts, with connectors between related items and notes
// pointing at what they annotate. Each item renders at its computed width,
// the page measures its height, and the layout settles; an item shows (and
// enters) once it's measured. Moves glide (FLIP from the last rects),
// updates flash and cross-fade, removals fade out where they were.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { edgeToward, hashOf, layoutOrganic, linkEnds, organicWidths, type Link, type OrganicItem, type Placed } from "../organic";
import { accentOf, type OrganicLook } from "../looks";
import type { CanvasItem } from "../shared";
import { enter, exit, fadeIn, fadeOut, highlight, move, restyle, type Rect } from "./motion";
import { OrganicBody, organicLabel, tilePadding } from "./organic-items";

const versionOf = (item: CanvasItem) => `${item.rev}:${item.updatedAt}`;
/** An unmeasured item shows anyway after this long (a frame that never reports). */
const MEASURE_TIMEOUT_MS = 2500;

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export const toOrganic = (item: CanvasItem, look: OrganicLook): OrganicItem => ({ id: item.id, kind: item.kind, size: item.size, importance: item.importance, createdAt: item.createdAt, updatedAt: item.updatedAt, relatedTo: item.relatedTo ?? [], anchor: item.anchor ?? null, point: item.point ?? null, accent: accentOf(item.kind, item.options, look) });

/** Panel tags for the instrument look: A1, A2, … in reading order. */
function tagsOf(rects: ReadonlyMap<string, Placed>): Map<string, string> {
  const order = [...rects.entries()].filter(([, rect]) => !rect.floating).sort(([, a], [, b]) => a.y - b.y || a.x - b.x);
  return new Map(order.map(([id], index) => [id, `${String.fromCharCode(65 + Math.floor(index / 9))}${(index % 9) + 1}`]));
}

const KIND_TAG: Partial<Record<string, string>> = { line: "TREND", area: "TREND", bar: "BARS", pie: "SHARE", table: "TABLE", list: "LIST", map: "MAP", timeline: "TIME", multiples: "GRID", custom: "LIVE", image: "IMG", stat: "VAL" };

/** An item's card: chrome by look, content cross-faded when it changes. */
function Card({ item, look, mode, width, focus, tag, onMeasure }: { item: CanvasItem; look: OrganicLook; mode: "light" | "dark"; width: number; focus: boolean; tag?: string; onMeasure?(height: number): void }) {
  const accent = accentOf(item.kind, item.options, look);
  const pad = tilePadding(look, item.kind, accent);
  const label = look === "instrument" && item.kind !== "headline" && item.kind !== "note" ? item.title ?? (item.kind === "custom" ? item.id : null) : organicLabel(item);
  const inner = Math.max(40, width - pad * 2 - (look === "instrument" ? 2 : 0));
  const measure = useRef<HTMLDivElement>(null);
  const frameReported = useRef(item.kind !== "custom");
  const report = useRef(onMeasure);
  report.current = onMeasure;
  useLayoutEffect(() => {
    const element = measure.current;
    if (!element) return;
    const send = () => { if (frameReported.current) report.current?.(Math.ceil(element.offsetHeight)); };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // A new width (the lead narrows when the rail fills, a style switch) is
  // measured on purpose too, now and once the content (a frame) has redrawn:
  // a resize observer in a background tab may never call back.
  useLayoutEffect(() => {
    const send = () => { if (measure.current && frameReported.current) report.current?.(Math.ceil(measure.current.offsetHeight)); };
    send();
    const timer = setTimeout(send, 450);
    return () => clearTimeout(timer);
  }, [width]);
  // Layers: the current content in flow, the previous one fading out over it.
  const version = versionOf(item);
  const [layers, setLayers] = useState<{ version: string; item: CanvasItem }[]>([{ version, item }]);
  useLayoutEffect(() => {
    setLayers((current) => (current.at(-1)!.version === version ? current : [...current.slice(-1), { version, item }]));
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = layers.map((layer, index) => (index === layers.length - 1 ? { ...layer, item } : layer));
  const onFrameHeight = useCallback(() => {
    if (frameReported.current) return;
    frameReported.current = true;
    // The frame's new height lands in the next frame.
    setTimeout(() => { if (measure.current) report.current?.(Math.ceil(measure.current.offsetHeight)); }, 16);
  }, []);
  return (
    <div ref={measure} className="cvt-card" data-kind={item.kind}>
      {label ? (
        <div className="cvt-head" style={look === "instrument" ? undefined : { padding: pad ? `${pad}px ${pad}px 0` : undefined, marginBottom: pad ? 8 : undefined }}>
          {tag ? <b className="cvt-tag">{tag}</b> : null}
          <span>{label}</span>
          {look === "instrument" && KIND_TAG[item.kind] ? <i className="cvt-kind">{KIND_TAG[item.kind]}</i> : null}
        </div>
      ) : null}
      <div className="cvt-body" style={{ padding: label && look !== "instrument" ? `0 ${pad}px ${pad}px` : pad, position: "relative" }}>
        {shown.map((layer, index) => {
          const leaving = index < shown.length - 1;
          return (
            <div
              key={layer.version}
              style={leaving ? { position: "absolute", left: pad, right: pad, top: label && look !== "instrument" ? 0 : pad, pointerEvents: "none" } : undefined}
              data-canvas-layer={leaving ? "leaving" : "current"}
              ref={(element) => {
                const role = leaving ? "out" : "in";
                if (!element || element.dataset.animated === role || (role === "in" && element.dataset.animated === "out")) return;
                element.dataset.animated = role;
                if (leaving) {
                  const drop = () => setLayers((current) => current.filter((each) => each.version !== layer.version));
                  fadeOut(element, drop);
                  setTimeout(drop, 900);
                } else if (shown.length > 1) fadeIn(element);
              }}
            >
              <OrganicBody item={layer.item} width={inner} focus={focus} look={look} mode={mode} onFrameHeight={leaving ? undefined : onFrameHeight} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function linkPath(look: OrganicLook, link: Link, ends: { x1: number; y1: number; x2: number; y2: number }): string {
  const { x1, y1, x2, y2 } = ends;
  if (look === "field") {
    // A loose curve, bowed to one side (from the ids), like a marker stroke.
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const bow = (hashOf(link.from + link.to) % 2 ? 1 : -1) * Math.min(60, len * 0.2);
    return `M${x1} ${y1} Q${Math.round(mx - (dy / len) * bow)} ${Math.round(my + (dx / len) * bow)} ${x2} ${y2}`;
  }
  if (look === "instrument") {
    // An elbow, like a wiring diagram.
    if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) { const mx = Math.round((x1 + x2) / 2); return `M${x1} ${y1} H${mx} V${y2} H${x2}`; }
    const my = Math.round((y1 + y2) / 2);
    return `M${x1} ${y1} V${my} H${x2} V${y2}`;
  }
  return `M${x1} ${y1} L${x2} ${y2}`;
}

/** Connectors and leader lines, under the cards (related) or over them (a note's pointer). */
function Links({ links, rects, look, width, height, layer, seen }: { links: readonly Link[]; rects: ReadonlyMap<string, Placed>; look: OrganicLook; width: number; height: number; layer: "under" | "over"; seen: Set<string> }) {
  const shown = links.filter((link) => (link.kind === "anchor") === (layer === "over"));
  if (!shown.length) return null;
  const color = (link: Link) => (look === "field" ? (link.kind === "anchor" ? "var(--cv-red)" : "var(--cv-accent)") : look === "instrument" ? "var(--cv-accent)" : link.kind === "anchor" ? "var(--cv-accent)" : "var(--cv-muted)");
  return (
    <svg className="cvt-links" width={width} height={height} style={{ zIndex: layer === "over" ? 6 : 0 }} aria-hidden data-canvas-links={layer}>
      <defs>
        <marker id={`cvt-arrow-${layer}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="context-stroke" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></marker>
      </defs>
      {shown.map((link) => {
        const from = rects.get(link.from);
        const to = rects.get(link.to);
        if (!from || !to) return null;
        let ends = linkEnds(from, to, link.point);
        // A note right beside its anchor gets a short tick to the anchor's edge and a ring at the point,
        // not a line across the anchor's content.
        let ring: { x: number; y: number } | null = null;
        if (link.kind === "anchor") {
          const edge = edgeToward(to, { x: ends.x1, y: ends.y1 }, { x: ends.x2, y: ends.y2 });
          if (Math.hypot(edge.x - ends.x1, edge.y - ends.y1) < 64 && Math.hypot(ends.x2 - edge.x, ends.y2 - edge.y) > 24) {
            ring = { x: ends.x2, y: ends.y2 };
            ends = { x1: ends.x1, y1: ends.y1, x2: edge.x, y2: edge.y };
          }
        }
        const d = linkPath(look, link, ends);
        const key = `${link.kind}:${link.from}>${link.to}`;
        const fresh = !seen.has(key);
        const stroke = color(link);
        const widthPx = look === "field" ? 2.2 : look === "instrument" ? 1 : link.kind === "anchor" ? 1.2 : 1;
        return (
          <g key={key} data-canvas-link={key}>
            <path className={`cvt-link${fresh && look !== "instrument" ? " cvt-link-new" : ""}`} d={d} style={{ d: `path("${d}")` } as React.CSSProperties} pathLength={look === "instrument" ? undefined : 1} stroke={stroke} strokeWidth={widthPx} strokeDasharray={look === "instrument" ? "3 2" : undefined} strokeLinecap="round" markerEnd={look === "field" ? `url(#cvt-arrow-${layer})` : undefined} />
            {look === "editorial" ? <><circle cx={ends.x1} cy={ends.y1} r={2.5} fill={stroke} /><circle cx={ends.x2} cy={ends.y2} r={link.kind === "anchor" ? 3.5 : 2.5} fill={link.kind === "anchor" ? "none" : stroke} stroke={stroke} strokeWidth={1.2} /></> : null}
            {ring ? <circle cx={ring.x} cy={ring.y} r={look === "field" ? 9 : 6} fill="none" stroke={stroke} strokeWidth={look === "field" ? 2.2 : 1.4} strokeDasharray={look === "field" ? "4 3" : undefined} data-canvas-ring /> : null}
            {look === "instrument" ? <><rect x={ends.x1 - 2.5} y={ends.y1 - 2.5} width={5} height={5} fill={stroke} /><rect x={ends.x2 - 3} y={ends.y2 - 3} width={6} height={6} fill="none" stroke={stroke} /></> : null}
          </g>
        );
      })}
    </svg>
  );
}

export function OrganicBoard({ items, look, mode, empty, bottomPad = 24 }: { items: readonly CanvasItem[]; look: OrganicLook; mode: "light" | "dark"; empty?: ReactNode; bottomPad?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const layoutItems = useMemo(() => items.map((item) => toOrganic(item, look)), [items, look]);
  const widths = useMemo(() => organicWidths(layoutItems, width, look), [layoutItems, width, look]);

  // Measured heights, batched to one update per tick (a timer, not a frame:
  // a background tab runs no frames, and the board must settle there too). Keyed by id and width.
  const [heights, setHeights] = useState<Map<string, number>>(() => new Map());
  const pending = useRef(new Map<string, number>());
  /** Each item's latest height at any width: its stand-in while it's re-measured (after a style switch or resize), so it glides instead of vanishing. */
  const latest = useRef(new Map<string, number>());
  const frame = useRef<ReturnType<typeof setTimeout> | null>(null);
  const report = useCallback((id: string, w: number, height: number) => {
    pending.current.set(`${id}@${w}`, height);
    if (frame.current) return;
    frame.current = setTimeout(() => {
      frame.current = null;
      const batch = pending.current;
      pending.current = new Map();
      for (const [key, value] of batch) latest.current.set(key.slice(0, key.lastIndexOf("@")), value);
      setHeights((current) => {
        let changed = false;
        const next = new Map(current);
        for (const [key, value] of batch) if (next.get(key) !== value) { next.set(key, value); changed = true; }
        return changed ? next : current;
      });
    }, 16);
  }, []);
  useEffect(() => () => { if (frame.current) clearTimeout(frame.current); }, []);
  const { measured, exact } = useMemo(() => {
    const map = new Map<string, number>();
    let count = 0;
    for (const item of items) {
      const h = heights.get(`${item.id}@${widths.get(item.id)}`);
      if (h !== undefined) { map.set(item.id, h); count++; } else if (latest.current.has(item.id)) map.set(item.id, latest.current.get(item.id)!);
    }
    return { measured: map, exact: count };
  }, [heights, items, widths]);

  // Items that never report still show after a while.
  const [forced, setForced] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const waiting = items.filter((item) => !measured.has(item.id) && !forced.has(item.id)).map((item) => item.id);
    if (!waiting.length) return;
    const timer = setTimeout(() => setForced((current) => new Set([...current, ...waiting])), MEASURE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [items, measured, forced]);
  const ready = useCallback((id: string) => measured.has(id) || forced.has(id), [measured, forced]);

  const previous = useRef<{ width: number; rects: Map<string, Placed> } | null>(null);
  const layout = useMemo(() => layoutOrganic(layoutItems, width, look, measured, previous.current?.width === width ? previous.current.rects : null), [layoutItems, width, look, measured]);
  const tags = useMemo(() => (look === "instrument" ? tagsOf(layout.rects) : new Map<string, string>()), [layout, look]);

  const elements = useRef(new Map<string, HTMLElement>());
  const last = useRef<{ rects: Map<string, Rect>; ready: Set<string>; versions: Map<string, string>; items: Map<string, CanvasItem>; width: number; look: OrganicLook } | null>(null);
  const [ghosts, setGhosts] = useState<{ key: string; item: CanvasItem; rect: Placed }[]>([]);
  const seenLinks = useRef(new Set<string>());
  const [, setLinksSeen] = useState(0);

  const rectOf = (placed: Placed): Rect => ({ left: placed.x, top: placed.y, width: placed.w, height: placed.h });
  useLayoutEffect(() => {
    if (!width) return;
    // Only a settled layout (every item measured) is the next one's stability hint, so the first settle isn't stuck on estimates.
    if (exact === items.length) previous.current = { width, rects: layout.rects };
    const rects = new Map<string, Rect>();
    for (const [id, placed] of layout.rects) rects.set(id, rectOf(placed));
    const before = last.current;
    const nowReady = new Set(items.filter((item) => ready(item.id)).map((item) => item.id));
    let entering = 0;
    let restyled = 0;
    const switched = !!before && before.look !== look;
    const order = [...items].sort((a, b) => { const ra = layout.rects.get(a.id); const rb = layout.rects.get(b.id); return (ra?.y ?? 0) - (rb?.y ?? 0) || (ra?.x ?? 0) - (rb?.x ?? 0); });
    for (const item of order) {
      if (!nowReady.has(item.id)) continue;
      const element = elements.current.get(item.id) ?? null;
      const to = rects.get(item.id);
      if (!to) continue;
      const from = before?.rects.get(item.id);
      if (!before?.ready.has(item.id) || !from) { enter(element, entering++); continue; }
      if (before.width === width) move(element, from, to);
      if (switched) restyle(element, restyled++);
      else if (before.versions.get(item.id) !== versionOf(item)) highlight(element);
    }
    if (before) {
      const gone = [...before.items.values()].filter((item) => !layout.rects.has(item.id) && before.ready.has(item.id));
      if (gone.length) setGhosts((current) => [...current, ...gone.map((item) => { const r = before.rects.get(item.id)!; return { key: `${item.id}:${versionOf(item)}:${Date.now()}`, item, rect: { x: r.left, y: r.top, w: r.width, h: r.height, rotate: 0, z: 0, floating: false, lane: 0, units: 0 } }; })]);
    }
    last.current = { rects, ready: nowReady, versions: new Map(items.map((item) => [item.id, versionOf(item)])), items: new Map(items.map((item) => [item.id, item])), width, look };
    // Links drawn this frame are no longer new after their draw-in.
    const keys = layout.links.map((link) => `${link.kind}:${link.from}>${link.to}`).filter((key) => !seenLinks.current.has(key) && nowReady.has(key.split(":")[1]!.split(">")[0]!));
    if (keys.length) { const timer = setTimeout(() => { keys.forEach((key) => seenLinks.current.add(key)); setLinksSeen((n) => n + 1); }, 1400); return () => clearTimeout(timer); }
  }, [layout, width]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ghosts.length) return;
    const timer = setTimeout(() => setGhosts([]), 1500);
    return () => clearTimeout(timer);
  }, [ghosts]);

  const visibleRects = useMemo(() => new Map([...layout.rects].filter(([id]) => ready(id))), [layout, ready]);
  const visibleLinks = layout.links.filter((link) => visibleRects.has(link.from) && visibleRects.has(link.to));
  const ghostBottom = ghosts.reduce((max, ghost) => Math.max(max, ghost.rect.y + ghost.rect.h), 0);
  const height = Math.max(layout.height, ghostBottom);
  return (
    <div ref={ref} className="canvas-board relative w-full" style={{ height: height + bottomPad }} data-canvas-board data-canvas-look={look} data-items={items.length} data-measured={exact}>
      {width ? (
        <>
          <Links links={visibleLinks} rects={visibleRects} look={look} width={width} height={height} layer="under" seen={seenLinks.current} />
          {ghosts.map((ghost, index) => <Ghost key={ghost.key} ghost={ghost} index={index} look={look} mode={mode} onDone={() => setGhosts((current) => current.filter((each) => each.key !== ghost.key))} />)}
          {items.map((item) => {
            const placed = layout.rects.get(item.id);
            const w = widths.get(item.id);
            if (!placed || !w) return null;
            const shown = ready(item.id);
            return (
              <section
                key={item.id}
                ref={(element) => { if (element) elements.current.set(item.id, element); else elements.current.delete(item.id); }}
                className="cvt"
                aria-label={item.title ?? item.id}
                data-canvas-item={item.id}
                data-canvas-kind={item.kind}
                data-kind={item.kind}
                data-accent={accentOf(item.kind, item.options, look) ?? undefined}
                data-focus={layout.focusId === item.id || undefined}
                data-floating={placed.floating || undefined}
                style={{ left: placed.x, top: placed.y, width: w, zIndex: placed.z, visibility: shown ? undefined : "hidden" }}
              >
                <div className="cvt-rot" style={placed.rotate ? { transform: `rotate(${placed.rotate}deg)` } : undefined}>
                  <Card item={item} look={look} mode={mode} width={w} focus={layout.focusId === item.id} tag={tags.get(item.id)} onMeasure={(h) => report(item.id, w, h)} />
                </div>
              </section>
            );
          })}
          <Links links={visibleLinks} rects={visibleRects} look={look} width={width} height={height} layer="over" seen={seenLinks.current} />
        </>
      ) : null}
      {!items.length && !ghosts.length && empty ? <div className="pointer-events-none absolute inset-x-0 top-[28vh] flex justify-center">{empty}</div> : null}
    </div>
  );
}

function Ghost({ ghost, index, look, mode, onDone }: { ghost: { item: CanvasItem; rect: Placed }; index: number; look: OrganicLook; mode: "light" | "dark"; onDone(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { exit(ref.current, onDone, index); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className="cvt" style={{ left: ghost.rect.x, top: ghost.rect.y, width: ghost.rect.w, zIndex: 0, pointerEvents: "none" }} aria-hidden data-canvas-ghost={ghost.item.id} data-kind={ghost.item.kind} data-accent={accentOf(ghost.item.kind, ghost.item.options, look) ?? undefined}>
      <Card item={ghost.item} look={look} mode={mode} width={ghost.rect.w} focus={false} />
    </div>
  );
}
