// Whiteboards: a Studio Draw drawing sketched on inline in a page. Pages
// reads the drawing's Excalidraw scene through Draw's RPC, draws it as plain
// SVG (no Excalidraw bundle in Pages), and saves pen strokes and erasures
// back as ordinary Excalidraw elements. Draw merges them by element version,
// so the full Draw editor and agents keep working on the same drawing.
import { z } from "zod";

export const DRAW_PLUGIN_ID = "excalidraw";
export const WHITEBOARD_COLORS = ["#1e1e1e", "#e03131", "#1971c2", "#2f9e44", "#f08c00"] as const;
const MAX_ELEMENTS = 2000;
const MAX_IMAGE_CHARS = 1_500_000;
const PADDING = 24;
const DEFAULT_STROKE = "#1e1e1e";

export type SceneElement = Record<string, unknown> & { id: string; type: string };
export type Scene = { elements: SceneElement[]; appState: Record<string, unknown>; files: Record<string, unknown> };

export const whiteboardStrokeSchema = z.object({
  /** Scene coordinates, in drawing order. */
  points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(1).max(5000),
  color: z.enum(WHITEBOARD_COLORS),
  width: z.number().min(0.5).max(16),
});
export type WhiteboardStroke = z.infer<typeof whiteboardStrokeSchema>;

export const whiteboardViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  updatedAt: z.number(),
  /** Scene-space viewBox [x, y, width, height]; null when the drawing is empty. */
  viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  /** Sanitized SVG markup, one `<g data-id>` per element. */
  markup: z.string(),
});
export type WhiteboardView = z.infer<typeof whiteboardViewSchema>;

export function parseScene(data: string): Scene {
  try {
    const parsed = JSON.parse(data) as Partial<Scene>;
    return {
      elements: Array.isArray(parsed.elements) ? parsed.elements.filter((el): el is SceneElement => !!el && typeof el === "object" && typeof (el as SceneElement).id === "string") : [],
      appState: parsed.appState && typeof parsed.appState === "object" ? parsed.appState : {},
      files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
    };
  } catch {
    return { elements: [], appState: {}, files: {} };
  }
}

const live = (scene: Scene) => scene.elements.filter((el) => el.isDeleted !== true);

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** A color Excalidraw wrote, or the fallback; never raw text into markup. */
function color(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (value === "transparent") return "none";
  return /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(value) ? value : fallback;
}

function points(element: SceneElement): [number, number][] {
  const raw = Array.isArray(element.points) ? element.points : [];
  const out: [number, number][] = [];
  for (const point of raw) if (Array.isArray(point) && point.length >= 2) out.push([num(point[0]), num(point[1])]);
  return out;
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function bounds(element: SceneElement): Box {
  const x = num(element.x);
  const y = num(element.y);
  if (element.type === "line" || element.type === "arrow" || element.type === "freedraw") {
    const list = points(element);
    if (list.length) {
      const xs = list.map(([px]) => x + px);
      const ys = list.map(([, py]) => y + py);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
  }
  const width = num(element.width);
  const height = num(element.height);
  return { minX: Math.min(x, x + width), minY: Math.min(y, y + height), maxX: Math.max(x, x + width), maxY: Math.max(y, y + height) };
}

function strokeAttributes(element: SceneElement): string {
  const width = Math.max(0.5, num(element.strokeWidth, 2));
  const dash =
    element.strokeStyle === "dashed" ? ` stroke-dasharray="${width * 4} ${width * 3}"` :
    element.strokeStyle === "dotted" ? ` stroke-dasharray="${width} ${width * 2}"` : "";
  return `stroke="${color(element.strokeColor, DEFAULT_STROKE)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash}`;
}

function arrowhead(from: [number, number], to: [number, number], stroke: string): string {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const length = Math.min(20, Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.5);
  if (length < 2) return "";
  const wing = (offset: number) => `${to[0] - length * Math.cos(angle + offset)},${to[1] - length * Math.sin(angle + offset)}`;
  return `<polyline points="${wing(0.45)} ${to[0]},${to[1]} ${wing(-0.45)}" fill="none" ${stroke}/>`;
}

function fontFamily(value: unknown): string {
  if (value === 3 || value === 8) return "ui-monospace, Menlo, monospace";
  if (value === 1 || value === 5) return "'Comic Sans MS', 'Segoe Print', cursive";
  return "system-ui, -apple-system, 'Segoe UI', sans-serif";
}

function text(element: SceneElement): string {
  const content = typeof element.text === "string" ? element.text : "";
  if (!content.trim()) return "";
  const size = Math.max(1, num(element.fontSize, 20));
  const lineHeight = size * num(element.lineHeight, 1.25);
  const x = num(element.x);
  const y = num(element.y);
  const width = num(element.width);
  const align = element.textAlign === "center" ? "middle" : element.textAlign === "right" ? "end" : "start";
  const anchorX = align === "middle" ? x + width / 2 : align === "end" ? x + width : x;
  const spans = content.split("\n").slice(0, 200)
    .map((line, index) => `<tspan x="${anchorX}" y="${y + index * lineHeight + size}">${escape(line.slice(0, 500))}</tspan>`).join("");
  return `<text font-family="${escape(fontFamily(element.fontFamily))}" font-size="${size}" text-anchor="${align}" fill="${color(element.strokeColor, DEFAULT_STROKE)}">${spans}</text>`;
}

function shape(element: SceneElement, scene: Scene): string {
  const x = num(element.x);
  const y = num(element.y);
  const width = num(element.width);
  const height = num(element.height);
  const stroke = strokeAttributes(element);
  const fill = color(element.backgroundColor, "none");
  switch (element.type) {
    case "rectangle": {
      const rounded = element.roundness ? Math.min(Math.abs(width), Math.abs(height)) * 0.1 : 0;
      return `<rect x="${Math.min(x, x + width)}" y="${Math.min(y, y + height)}" width="${Math.abs(width)}" height="${Math.abs(height)}" rx="${rounded}" fill="${fill}" ${stroke}/>`;
    }
    case "diamond":
      return `<polygon points="${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}" fill="${fill}" ${stroke}/>`;
    case "ellipse":
      return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${Math.abs(width) / 2}" ry="${Math.abs(height) / 2}" fill="${fill}" ${stroke}/>`;
    case "line":
    case "arrow":
    case "freedraw": {
      const list = points(element).map(([px, py]) => [x + px, y + py] as [number, number]);
      if (list.length === 1) list.push([list[0]![0] + 0.01, list[0]![1]]);
      if (list.length < 2) return "";
      const closed = element.type === "line" && fill !== "none";
      const path = `<polyline points="${list.map(([px, py]) => `${px},${py}`).join(" ")}" fill="${closed ? fill : "none"}" ${stroke}/>`;
      if (element.type !== "arrow") return path;
      const end = element.endArrowhead === undefined ? "arrow" : element.endArrowhead;
      return path + (end ? arrowhead(list[list.length - 2]!, list[list.length - 1]!, stroke) : "") + (element.startArrowhead ? arrowhead(list[1]!, list[0]!, stroke) : "");
    }
    case "text":
      return text(element);
    case "frame":
    case "magicframe":
      return `<rect x="${x}" y="${y}" width="${Math.abs(width)}" height="${Math.abs(height)}" rx="6" fill="none" stroke="#bbb" stroke-width="1.5"/>`;
    case "image": {
      const fileId = typeof element.fileId === "string" ? element.fileId : "";
      const file = scene.files[fileId] as { dataURL?: unknown } | undefined;
      const url = typeof file?.dataURL === "string" ? file.dataURL : "";
      if (!/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(url) || url.length > MAX_IMAGE_CHARS) {
        return `<rect x="${x}" y="${y}" width="${Math.abs(width)}" height="${Math.abs(height)}" fill="#eee"/>`;
      }
      return `<image x="${x}" y="${y}" width="${Math.abs(width)}" height="${Math.abs(height)}" preserveAspectRatio="none" href="${url}"/>`;
    }
    default:
      return "";
  }
}

/** The scene as SVG markup in scene coordinates, one group per element. */
export function renderWhiteboard(scene: Scene): { viewBox: [number, number, number, number] | null; markup: string } {
  const elements = live(scene).sort(compareIndex).slice(0, MAX_ELEMENTS);
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const parts: string[] = [];
  for (const element of elements) {
    const markup = shape(element, scene);
    if (!markup) continue;
    const b = bounds(element);
    box.minX = Math.min(box.minX, b.minX);
    box.minY = Math.min(box.minY, b.minY);
    box.maxX = Math.max(box.maxX, b.maxX);
    box.maxY = Math.max(box.maxY, b.maxY);
    const angle = num(element.angle);
    const opacity = Math.min(100, Math.max(0, num(element.opacity, 100))) / 100;
    const transform = angle ? ` transform="rotate(${(angle * 180) / Math.PI} ${(b.minX + b.maxX) / 2} ${(b.minY + b.maxY) / 2})"` : "";
    parts.push(`<g data-id="${escape(element.id)}"${opacity < 1 ? ` opacity="${opacity}"` : ""}${transform}>${markup}</g>`);
  }
  if (!parts.length) return { viewBox: null, markup: "" };
  return {
    viewBox: [box.minX - PADDING, box.minY - PADDING, Math.max(1, box.maxX - box.minX + PADDING * 2), Math.max(1, box.maxY - box.minY + PADDING * 2)],
    markup: parts.join(""),
  };
}

function compareIndex(a: SceneElement, b: SceneElement): number {
  const ia = typeof a.index === "string" ? a.index : "";
  const ib = typeof b.index === "string" ? b.index : "";
  return ia === ib ? 0 : ia < ib ? -1 : 1;
}

const nonce = () => Math.floor(Math.random() * 2_147_483_647);
const elementId = () => `pg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * The elements to merge into the drawing: new freedraw strokes on top, and
 * tombstones (a bumped version) for erased elements. Draw's saveDrawing
 * merges by id and version, so everything else in the drawing is kept.
 */
export function whiteboardChanges(scene: Scene, add: WhiteboardStroke[], erase: string[], now = Date.now()): SceneElement[] {
  const out: SceneElement[] = [];
  const byId = new Map(scene.elements.map((el) => [el.id, el]));
  for (const id of new Set(erase)) {
    const existing = byId.get(id);
    if (!existing || existing.isDeleted === true) continue;
    out.push({ ...existing, isDeleted: true, version: num(existing.version, 1) + 1, versionNonce: nonce(), updated: now });
  }
  let index = live(scene).reduce<string | null>((max, el) => (typeof el.index === "string" && el.index && (max === null || el.index > max) ? el.index : max), null);
  for (const stroke of add) {
    const [x0, y0] = stroke.points[0]!;
    const relative = stroke.points.map(([px, py]) => [px - x0, py - y0] as [number, number]);
    const xs = relative.map(([px]) => px);
    const ys = relative.map(([, py]) => py);
    index = nextIndex(index);
    out.push({
      id: elementId(), type: "freedraw", x: x0, y: y0,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      angle: 0, strokeColor: stroke.color, backgroundColor: "transparent", fillStyle: "solid",
      strokeWidth: stroke.width, strokeStyle: "solid", roughness: 1, opacity: 100,
      groupIds: [], frameId: null, roundness: null, index, seed: nonce(), version: 1, versionNonce: nonce(),
      isDeleted: false, boundElements: null, updated: now, link: null, locked: false,
      points: relative, pressures: [], simulatePressure: true, lastCommittedPoint: relative[relative.length - 1] ?? null,
    });
  }
  return out;
}

/** The scene JSON Draw's saveDrawing merges. */
export function changesData(elements: SceneElement[]): string {
  return JSON.stringify({ type: "excalidraw", version: 2, source: "bb-studio-pages", elements, appState: {}, files: {} });
}

// Fractional indexing (z-order for new elements), from `fractional-indexing`
// (CC0) as Studio Draw uses it.
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function midpoint(a: string, b: string | null): string {
  const zero = DIGITS[0]!;
  if (b) {
    let n = 0;
    while ((a[n] || zero) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b != null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - 97 + 2;
  if (head >= "A" && head <= "Z") return 90 - head.charCodeAt(0) + 2;
  throw new Error("invalid order key head: " + head);
}

function incrementInteger(x: string): string | null {
  const [head, ...digs] = x.split("");
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]!) + 1;
    if (d === DIGITS.length) digs[i] = DIGITS[0]!;
    else { digs[i] = DIGITS[d]!; carry = false; }
  }
  if (carry) {
    if (head === "Z") return "a" + DIGITS[0];
    if (head === "z") return null;
    const h = String.fromCharCode(head!.charCodeAt(0) + 1);
    if (h > "a") digs.push(DIGITS[0]!);
    else digs.pop();
    return h + digs.join("");
  }
  return head + digs.join("");
}

/** A key after `a` (or the first key). */
export function nextIndex(a: string | null): string {
  if (a === null) return "a" + DIGITS[0];
  try {
    const integer = a.slice(0, integerLength(a[0]!));
    const fraction = a.slice(integer.length);
    const next = incrementInteger(integer);
    return next === null ? integer + midpoint(fraction, null) : next;
  } catch {
    return `${a}V`;
  }
}
