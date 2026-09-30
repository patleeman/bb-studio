// A small SVG sketch of a scene for Studio's cards. Rendering the real
// Excalidraw export needs a DOM, so this draws each element's geometry
// cleanly instead of hand-drawn. It stays current after agent edits without
// anyone opening the editor.
//
// The background is transparent and colors stay as drawn in light mode;
// Studio inverts thumbnails in dark mode.
import { getNonDeletedElements, type SceneElement, type StoredScene } from "../../lib/merge";

const MAX_ELEMENTS = 2000;
const MAX_IMAGE_CHARS = 1_500_000;
const PADDING = 16;
const DEFAULT_STROKE = "#1e1e1e";

type Box = { minX: number; minY: number; maxX: number; maxY: number };

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
  for (const point of raw) {
    if (Array.isArray(point) && point.length >= 2) out.push([num(point[0]), num(point[1])]);
  }
  return out;
}

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
  return {
    minX: Math.min(x, x + width),
    minY: Math.min(y, y + height),
    maxX: Math.max(x, x + width),
    maxY: Math.max(y, y + height),
  };
}

function strokeAttributes(element: SceneElement): string {
  const width = Math.max(0.5, num(element.strokeWidth, 2));
  const dash =
    element.strokeStyle === "dashed" ? ` stroke-dasharray="${width * 4} ${width * 3}"` :
    element.strokeStyle === "dotted" ? ` stroke-dasharray="${width} ${width * 2}"` : "";
  return `stroke="${color(element.strokeColor, DEFAULT_STROKE)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash}`;
}

function fill(element: SceneElement): string {
  return color(element.backgroundColor, "none");
}

function arrowhead(from: [number, number], to: [number, number], stroke: string): string {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const length = Math.min(20, Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.5);
  if (length < 2) return "";
  const wing = (offset: number) =>
    `${to[0] - length * Math.cos(angle + offset)},${to[1] - length * Math.sin(angle + offset)}`;
  return `<polyline points="${wing(0.45)} ${to[0]},${to[1]} ${wing(-0.45)}" fill="none" ${stroke}/>`;
}

function fontFamily(value: unknown): string {
  // Excalidraw's families: 3 and 8 are monospace; 2, 6 and 7 sans; the rest handwritten.
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
  const lines = content.split("\n").slice(0, 200);
  const spans = lines
    .map((line, index) => `<tspan x="${anchorX}" y="${y + index * lineHeight + size}">${escape(line.slice(0, 500))}</tspan>`)
    .join("");
  return `<text font-family="${escape(fontFamily(element.fontFamily))}" font-size="${size}" text-anchor="${align}" fill="${color(element.strokeColor, DEFAULT_STROKE)}">${spans}</text>`;
}

function shape(element: SceneElement, scene: StoredScene): string {
  const x = num(element.x);
  const y = num(element.y);
  const width = num(element.width);
  const height = num(element.height);
  const stroke = strokeAttributes(element);
  switch (element.type) {
    case "rectangle": {
      const rounded = element.roundness ? Math.min(Math.abs(width), Math.abs(height)) * 0.1 : 0;
      return `<rect x="${Math.min(x, x + width)}" y="${Math.min(y, y + height)}" width="${Math.abs(width)}" height="${Math.abs(height)}" rx="${rounded}" fill="${fill(element)}" ${stroke}/>`;
    }
    case "diamond":
      return `<polygon points="${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}" fill="${fill(element)}" ${stroke}/>`;
    case "ellipse":
      return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${Math.abs(width) / 2}" ry="${Math.abs(height) / 2}" fill="${fill(element)}" ${stroke}/>`;
    case "line":
    case "arrow":
    case "freedraw": {
      const list = points(element).map(([px, py]) => [x + px, y + py] as [number, number]);
      if (list.length < 2) return "";
      const closed = element.type === "line" && fill(element) !== "none";
      const path = `<polyline points="${list.map(([px, py]) => `${px},${py}`).join(" ")}" fill="${closed ? fill(element) : "none"}" ${stroke}/>`;
      if (element.type !== "arrow") return path;
      const end = element.endArrowhead === undefined ? "arrow" : element.endArrowhead;
      return (
        path +
        (end ? arrowhead(list[list.length - 2]!, list[list.length - 1]!, stroke) : "") +
        (element.startArrowhead ? arrowhead(list[1]!, list[0]!, stroke) : "")
      );
    }
    case "text":
      return text(element);
    case "frame":
    case "magicframe":
      return `<rect x="${x}" y="${y}" width="${Math.abs(width)}" height="${Math.abs(height)}" rx="6" fill="none" stroke="#bbb" stroke-width="1.5"/>`;
    case "image": {
      const fileId = typeof element.fileId === "string" ? element.fileId : "";
      const file = scene.files?.[fileId] as { dataURL?: unknown } | undefined;
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

/** The scene as a standalone SVG document, or null when it's empty. */
export function sceneThumbnail(scene: StoredScene | null): string | null {
  if (!scene) return null;
  const elements = getNonDeletedElements(scene).slice(0, MAX_ELEMENTS);
  if (!elements.length) return null;
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
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const transform = angle ? ` transform="rotate(${(angle * 180) / Math.PI} ${cx} ${cy})"` : "";
    parts.push(opacity < 1 || transform ? `<g opacity="${opacity}"${transform}>${markup}</g>` : markup);
  }
  if (!parts.length) return null;
  const x = box.minX - PADDING;
  const y = box.minY - PADDING;
  const width = Math.max(1, box.maxX - box.minX + PADDING * 2);
  const height = Math.max(1, box.maxY - box.minY + PADDING * 2);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${Math.round(width)}" height="${Math.round(height)}">`,
    ...parts,
    `</svg>`,
  ].join("");
}
