// The board in an organic look (looks.ts): items at their natural height,
// placed by organic.ts. Each item renders at its computed width,
// the page measures its height, and the layout settles; an item shows (and
// enters) once it's measured. Moves glide (FLIP from the last rects),
// updates flash and cross-fade, removals fade out where they were.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isVisualKind, layoutOrganic, organicSizes, type Frame, type OrganicItem, type Placed } from "../organic";
import { accentOf, type OrganicLook } from "../looks";
import type { CanvasItem, Composition } from "../shared";
import { enter, exit, fadeIn, fadeOut, highlight, move, restyle, type Rect } from "./motion";
import { OrganicBody, organicLabel, tilePadding } from "./organic-items";

const versionOf = (item: CanvasItem) => `${item.rev}:${item.updatedAt}`;
/** An unmeasured item shows anyway after this long (a frame that never reports). */
const MEASURE_TIMEOUT_MS = 2500;

/**
 * The visible board: its width, and the height of the scroll area it sits
 * in (less its top padding and the board's bottom pad), so the composition
 * fits the screen.
 */
function useFrame(ref: React.RefObject<HTMLElement | null>, bottomPad: number): Frame {
  const [frame, setFrame] = useState<Frame>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const host = element.parentElement;
    const read = () => {
      const pad = host ? parseFloat(getComputedStyle(host).paddingTop) || 0 : 0;
      const next = { width: element.clientWidth, height: Math.max(0, Math.round((host?.clientHeight ?? 0) - pad - bottomPad)) };
      setFrame((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    if (host) observer.observe(host);
    return () => observer.disconnect();
  }, [ref, bottomPad]);
  return frame;
}

/** A board item for the page: a canvas item, or (a reference board) one placed by hand. */
export type BoardItem = CanvasItem & { fixed?: { x: number; y: number; w: number } | null };

export const toOrganic = (item: BoardItem, look: OrganicLook): OrganicItem => ({
  id: item.id, kind: item.kind, size: item.size, importance: item.importance, createdAt: item.createdAt, updatedAt: item.updatedAt, accent: accentOf(item.kind, item.options, look),
  scale: item.scale ?? null, region: item.region ?? null, pinnedTo: item.pinnedTo ?? null, point: item.point ?? null, side: item.side ?? null, bleed: item.bleed ?? null,
  visual: isVisualKind(item.kind) || (item.kind === "custom" && item.options.visual === true), fixed: item.fixed ?? null,
});

/** Panel tags for the instrument look: A1, A2, … in reading order. */
function tagsOf(rects: ReadonlyMap<string, Placed>): Map<string, string> {
  const order = [...rects.entries()].sort(([, a], [, b]) => a.y - b.y || a.x - b.x);
  return new Map(order.map(([id], index) => [id, `${String.fromCharCode(65 + Math.floor(index / 9))}${(index % 9) + 1}`]));
}

const KIND_TAG: Partial<Record<string, string>> = { line: "TREND", area: "TREND", bar: "BARS", pie: "SHARE", table: "TABLE", list: "LIST", map: "MAP", timeline: "TIME", multiples: "GRID", custom: "LIVE", image: "IMG", stat: "VAL" };

/** An item's card: chrome by look, content cross-faded when it changes. */
function Card({ item, look, mode, width, room, focus, tag, onMeasure }: { item: CanvasItem; look: OrganicLook; mode: "light" | "dark"; width: number; room: number; focus: boolean; tag?: string; onMeasure?(height: number): void }) {
  const accent = accentOf(item.kind, item.options, look);
  const pad = tilePadding(look, item.kind, accent);
  const label = look === "instrument" && item.kind !== "headline" ? item.title ?? (item.kind === "custom" ? item.id : null) : organicLabel(item);
  const inner = Math.max(40, width - pad * 2);
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
          {look === "instrument" && KIND_TAG[item.kind] && !item.bleed ? <i className="cvt-kind">{KIND_TAG[item.kind]}</i> : null}
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
              <OrganicBody item={layer.item} width={inner} room={room} focus={focus} look={look} mode={mode} onFrameHeight={leaving ? undefined : onFrameHeight} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OrganicBoard({ items, look, mode, composition = null, empty, bottomPad = 24 }: { items: readonly BoardItem[]; look: OrganicLook; mode: "light" | "dark"; composition?: Composition | null; empty?: ReactNode; bottomPad?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useFrame(ref, bottomPad);
  const width = frame.width;
  const layoutItems = useMemo(() => items.map((item) => toOrganic(item, look)), [items, look]);
  const sizes = useMemo(() => organicSizes(layoutItems, frame, look, composition), [layoutItems, frame, look, composition]);
  const widths = useMemo(() => new Map([...sizes].map(([id, size]) => [id, size.w])), [sizes]);

  // Measured heights, batched to one update per tick (a timer, not a frame:
  // a background tab runs no frames, and the board must settle there too). Keyed by id and width.
  const [heights, setHeights] = useState<Map<string, number>>(() => new Map());
  const pending = useRef(new Map<string, number>());
  /** Each item's latest height at any width: its stand-in while it's re-measured (after a style switch or resize), so it glides instead of vanishing. */
  const latest = useRef(new Map<string, number>());
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const report = useCallback((id: string, w: number, height: number) => {
    pending.current.set(`${id}@${w}`, height);
    if (tick.current) return;
    tick.current = setTimeout(() => {
      tick.current = null;
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
  useEffect(() => () => { if (tick.current) clearTimeout(tick.current); }, []);
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

  const previous = useRef<{ width: number; height: number; rects: Map<string, Placed> } | null>(null);
  const layout = useMemo(() => layoutOrganic(layoutItems, frame, look, measured, previous.current?.width === frame.width && previous.current.height === frame.height ? previous.current.rects : null, composition), [layoutItems, frame, look, measured, composition]);
  const tags = useMemo(() => (look === "instrument" ? tagsOf(layout.rects) : new Map<string, string>()), [layout, look]);

  const elements = useRef(new Map<string, HTMLElement>());
  const last = useRef<{ rects: Map<string, Rect>; ready: Set<string>; versions: Map<string, string>; items: Map<string, CanvasItem>; width: number; look: OrganicLook } | null>(null);
  const [ghosts, setGhosts] = useState<{ key: string; item: CanvasItem; rect: Placed }[]>([]);

  const rectOf = (placed: Placed): Rect => ({ left: placed.x, top: placed.y, width: placed.w, height: placed.h });
  useLayoutEffect(() => {
    if (!width) return;
    // Only a settled layout (every item measured) is the next one's stability hint, so the first settle isn't stuck on estimates.
    if (exact === items.length) previous.current = { width: frame.width, height: frame.height, rects: layout.rects };
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
      if (gone.length) setGhosts((current) => [...current, ...gone.map((item) => { const r = before.rects.get(item.id)!; return { key: `${item.id}:${versionOf(item)}:${Date.now()}`, item, rect: { x: r.left, y: r.top, w: r.width, h: r.height, rotate: 0, z: 0, scale: "small" as const } }; })]);
    }
    last.current = { rects, ready: nowReady, versions: new Map(items.map((item) => [item.id, versionOf(item)])), items: new Map(items.map((item) => [item.id, item])), width, look };
  }, [layout, width]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ghosts.length) return;
    const timer = setTimeout(() => setGhosts([]), 1500);
    return () => clearTimeout(timer);
  }, [ghosts]);

  const ghostBottom = ghosts.reduce((max, ghost) => Math.max(max, ghost.rect.y + ghost.rect.h), 0);
  // The board fills the screen; it only scrolls when the composition is taller than it.
  // Fitted (a sparse board scaled up, or one just over the screen scaled down), the board is the screen; else it scrolls.
  const fit = layout.fit;
  const fitted = fit.scale !== 1 || fit.x !== 0 || fit.y !== 0;
  const height = fitted ? Math.max(frame.height, ghostBottom) : Math.max(layout.height, ghostBottom, items.length ? frame.height : 0);
  return (
    <div ref={ref} className="canvas-board relative w-full" style={{ height: height + bottomPad }} data-canvas-board data-canvas-look={look} data-canvas-composition={layout.composition} data-items={items.length} data-measured={exact} data-frame={`${frame.width}x${frame.height}`} data-fit={fit.scale}>
      {width ? (
        <div className="cvt-fit" style={{ transform: fitted ? `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` : undefined }}>
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
                data-scale={placed.scale}
                style={{ left: placed.x, top: placed.y, width: w, zIndex: placed.z, visibility: shown ? undefined : "hidden" }}
              >
                <div className="cvt-rot" style={placed.rotate ? { transform: `rotate(${placed.rotate}deg)` } : undefined}>
                  <Card item={item} look={look} mode={mode} width={w} room={sizes.get(item.id)?.room ?? 320} focus={placed.scale === "hero"} tag={tags.get(item.id)} onMeasure={(h) => report(item.id, w, h)} />
                </div>
              </section>
            );
          })}
        </div>
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
      <Card item={ghost.item} look={look} mode={mode} width={ghost.rect.w} room={ghost.rect.h} focus={false} />
    </div>
  );
}
