export const MAX_WORKERS = 8;
export const MAX_RIPPLES = 4;
export const RIPPLE_SECONDS = 2.6;

export const ENGINE_UNIFORMS = [
  "u_resolution", "u_time", "u_intensity", "u_motion", "u_palette", "u_workers", "u_ripples", "u_needsYou",
  "u_workerColor", "u_needsYouColor", "u_finishedColor", "u_errorColor", "u_clear", "u_open", "u_cards", "u_layer",
] as const;

export type ClearRect = readonly [number, number, number, number];

export const DEFAULT_CLEAR = { left: 580 / 1600, right: 1340 / 1600, top: 48 / 1000, bottom: 880 / 1000 } as const;

export function defaultClear(width: number, height: number): ClearRect {
  return [DEFAULT_CLEAR.left * width, (1 - DEFAULT_CLEAR.bottom) * height, DEFAULT_CLEAR.right * width, (1 - DEFAULT_CLEAR.top) * height];
}

export const WINDOW_SIDEBAR = 320;
export const WINDOW_COLUMN = 808;
export const WINDOW_TOP = 48;
export const WINDOW_BOTTOM = 12;

export function windowColumn(view: { width: number; height: number }): { left: number; top: number; right: number; bottom: number } {
  const left = Math.max(WINDOW_SIDEBAR, WINDOW_SIDEBAR + (view.width - WINDOW_SIDEBAR - WINDOW_COLUMN) / 2);
  return { left, top: WINDOW_TOP, right: Math.min(view.width, left + WINDOW_COLUMN), bottom: view.height - WINDOW_BOTTOM };
}

export function clearFromRect(rect: { left: number; top: number; right: number; bottom: number }, view: { width: number; height: number }, canvas: { width: number; height: number }): ClearRect {
  const sx = canvas.width / Math.max(1, view.width);
  const sy = canvas.height / Math.max(1, view.height);
  return [rect.left * sx, (view.height - rect.bottom) * sy, rect.right * sx, (view.height - rect.top) * sy];
}

export const OPEN_ROOM = 160;
export const MAX_CARDS = 3;

type Box = { left: number; top: number; right: number; bottom: number };

export function windowCards(view: { width: number; height: number }): Box[] {
  const column = windowColumn(view);
  return [{ left: 0, top: WINDOW_TOP, right: Math.min(view.width, WINDOW_SIDEBAR), bottom: view.height - WINDOW_BOTTOM }, column];
}

export function windowOpen(view: { width: number; height: number }): Box | null {
  const left = windowColumn(view).right;
  return view.width - left >= OPEN_ROOM ? { left, top: 0, right: view.width, bottom: view.height } : null;
}

export function defaultOpen(clear: ClearRect, width: number, height: number): ClearRect {
  return [clear[2], 0, width, height];
}

export function defaultCards(clear: ClearRect, width: number): Float32Array {
  return cardData([[0, clear[1], Math.max(0, clear[0] + clear[2] - width), clear[3]], clear]);
}

export function cardData(cards: readonly ClearRect[]): Float32Array {
  const data = new Float32Array(MAX_CARDS * 4);
  cards.slice(0, MAX_CARDS).forEach((card, index) => data.set(card, index * 4));
  return data;
}

export const PRELUDE = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_motion;
uniform vec3 u_palette[4];
uniform vec4 u_workers[${MAX_WORKERS}];
uniform vec4 u_ripples[${MAX_RIPPLES}];
uniform float u_needsYou;
uniform vec3 u_workerColor;
uniform vec3 u_needsYouColor;
uniform vec3 u_finishedColor;
uniform vec3 u_errorColor;
uniform vec4 u_clear;
uniform vec4 u_open;
uniform vec4 u_cards[${MAX_CARDS}];
uniform sampler2D u_layer;
float openFade(vec2 at, float inset) {
  float fade = 1.0;
  for (int i = 0; i < ${MAX_CARDS}; i++) {
    vec4 card = u_cards[i];
    float away = max(max(card.x - at.x, at.x - card.z), max(card.y - at.y, at.y - card.w));
    fade *= max(smoothstep(inset, 2.2 * inset, away), step(card.z, card.x + 0.5));
  }
  return fade;
}
float openFade(vec2 at) {
  return openFade(at, 0.045 * u_resolution.y);
}
`;

export const VERTEX_SOURCE = `attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

export function fragmentSource(source: string): string {
  return `${PRELUDE}#line 1\n${source}`;
}

export function workerSeed(slot: number): number {
  return Math.round(((slot * 0.6180339887 + 0.137) % 1) * 1000) / 1000;
}

export function workerAnchor(seed: number): { x: number; y: number } {
  return { x: 0.15 + 0.7 * seed, y: 0.2 };
}

export const CENTER_ANCHOR = { x: 0.5, y: 0.2 } as const;
