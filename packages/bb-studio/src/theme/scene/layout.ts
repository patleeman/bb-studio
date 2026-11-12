import { OPEN_ROOM, WINDOW_BOTTOM, WINDOW_COLUMN, WINDOW_TOP } from "./contract";

export interface LayoutRect { left: number; top: number; right: number; bottom: number }
export interface SceneLayout { width: number; height: number; sidebar: number; panel: LayoutRect | null }
export interface LayoutSample { width: number; height: number; sidebar: number; panel: LayoutRect | null | undefined }
export interface SceneInputs { layout(): SceneLayout | null; onLayout(run: () => void): () => void }

export const LAYOUT_SETTLE_MS = 250;
export const LAYOUT_GAP = 10;
export const SIDEBAR_SELECTOR = '[data-sidebar="gap"]';
export const PANEL_SELECTOR = '[data-sidebar="inset"] aside[data-surface-tone="sidebar"]';

const whole = (rect: LayoutRect): LayoutRect => ({ left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) });
const sameRect = (a: LayoutRect | null, b: LayoutRect | null) => a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom);

export function sameLayout(a: SceneLayout, b: SceneLayout): boolean {
  return a.width === b.width && a.height === b.height && a.sidebar === b.sidebar && sameRect(a.panel, b.panel);
}

export function measureLayout(doc: Document): LayoutSample {
  const view = doc.defaultView;
  const width = view?.innerWidth ?? 0, height = view?.innerHeight ?? 0;
  const gap = doc.querySelector(SIDEBAR_SELECTOR)?.getBoundingClientRect();
  const sidebar = gap && gap.width > 0 ? Math.max(0, gap.right) : 0;
  const asides = [...doc.querySelectorAll(PANEL_SELECTOR)];
  if (!asides.length) return { width, height, sidebar, panel: undefined };
  for (const aside of asides) {
    if (aside.getAttribute("aria-hidden") === "true" || aside.hasAttribute("inert")) continue;
    const rect = aside.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) return { width, height, sidebar, panel: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } };
  }
  return { width, height, sidebar, panel: null };
}

export class LayoutWatch {
  private settled: SceneLayout | null = null;
  private pending: { layout: SceneLayout; since: number } | null = null;

  current(): SceneLayout | null {
    return this.settled;
  }

  sample(sample: LayoutSample, now: number): boolean {
    const panel = sample.panel === undefined ? this.settled?.panel ?? null : sample.panel ? whole(sample.panel) : null;
    const layout: SceneLayout = { width: Math.round(sample.width), height: Math.round(sample.height), sidebar: Math.round(sample.sidebar), panel };
    if (!this.settled) { this.settled = layout; return true; }
    if (sameLayout(layout, this.settled)) { this.pending = null; return false; }
    if (!this.pending || !sameLayout(layout, this.pending.layout)) { this.pending = { layout, since: now }; return false; }
    if (now - this.pending.since < LAYOUT_SETTLE_MS) return false;
    this.settled = layout;
    this.pending = null;
    return true;
  }
}

export function layoutColumn(layout: SceneLayout): LayoutRect {
  const from = Math.min(layout.width, layout.sidebar + LAYOUT_GAP);
  const to = Math.max(from, (layout.panel ? Math.min(layout.width, layout.panel.left) : layout.width) - LAYOUT_GAP);
  const width = Math.min(WINDOW_COLUMN, to - from);
  const left = from + (to - from - width) / 2;
  return { left, top: WINDOW_TOP, right: left + width, bottom: layout.height - WINDOW_BOTTOM };
}

export function cardSlots(layout: SceneLayout): [LayoutRect | null, LayoutRect | null, LayoutRect | null] {
  const top = WINDOW_TOP, bottom = layout.height - WINDOW_BOTTOM;
  const real = (card: LayoutRect | null) => (card && card.right > card.left && card.bottom > card.top ? card : null);
  return [
    real(layout.sidebar > 0 ? { left: 0, top, right: Math.min(layout.width, layout.sidebar), bottom } : null),
    real(layoutColumn(layout)),
    real(layout.panel ? { left: Math.max(0, layout.panel.left), top: Math.max(0, layout.panel.top), right: Math.min(layout.width, layout.panel.right), bottom: Math.min(layout.height, layout.panel.bottom) } : null),
  ];
}

export function layoutCards(layout: SceneLayout): LayoutRect[] {
  return cardSlots(layout).filter((card): card is LayoutRect => !!card);
}

export function openAreas(layout: SceneLayout): LayoutRect[] {
  const cards = layoutCards(layout);
  const edges = (low: "left" | "top", high: "right" | "bottom", size: number) => [...new Set([0, size, ...cards.flatMap((card) => [card[low], card[high]])])].filter((edge) => edge >= 0 && edge <= size).sort((a, b) => a - b);
  const xs = edges("left", "right", layout.width), ys = edges("top", "bottom", layout.height);
  const free: LayoutRect[] = [];
  for (let i = 0; i < xs.length; i += 1) for (let j = i + 1; j < xs.length; j += 1) for (let k = 0; k < ys.length; k += 1) for (let m = k + 1; m < ys.length; m += 1) {
    const rect = { left: xs[i]!, top: ys[k]!, right: xs[j]!, bottom: ys[m]! };
    if (cards.every((card) => card.right <= rect.left || card.left >= rect.right || card.bottom <= rect.top || card.top >= rect.bottom)) free.push(rect);
  }
  const inside = (a: LayoutRect, b: LayoutRect) => a !== b && a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
  return free.filter((rect) => !free.some((other) => inside(rect, other)));
}

export interface OpenSpot { area: LayoutRect; x: number; y: number; roomy: boolean }

export const SPOT_TIE = 0.98;

export function openSpot(layout: SceneLayout, room: number): OpenSpot | null {
  const areas = openAreas(layout);
  const wide = (rect: LayoutRect) => rect.right - rect.left, tall = (rect: LayoutRect) => rect.bottom - rect.top;
  const rightmost = (list: LayoutRect[], measure: (rect: LayoutRect) => number): LayoutRect | null => {
    const most = Math.max(0, ...list.map(measure));
    const close = list.filter((rect) => measure(rect) >= most * SPOT_TIE);
    return close.length ? close.reduce((best, each) => (each.left > best.left ? each : best)) : null;
  };
  const middle = (rect: LayoutRect) => (rect.top + rect.bottom) / 2;
  const roomy = rightmost(areas.filter((rect) => Math.min(wide(rect), tall(rect)) >= room), (rect) => wide(rect) * tall(rect));
  if (roomy) return { area: roomy, x: (roomy.left + roomy.right) / 2, y: middle(roomy), roomy: true };
  const held = (rect: LayoutRect) => Math.min(Math.max((rect.left + rect.right) / 2, room / 2), layout.width - room / 2);
  const column = layoutColumn(layout);
  const gutter = rightmost(areas.filter((rect) => rect.left >= column.right && tall(rect) >= room && held(rect) >= rect.left && held(rect) <= rect.right), wide);
  return gutter ? { area: gutter, x: held(gutter), y: middle(gutter), roomy: false } : null;
}

export function openRect(layout: SceneLayout): LayoutRect | null {
  const spot = openSpot(layout, OPEN_ROOM);
  return spot?.roomy ? spot.area : null;
}
