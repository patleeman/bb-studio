import type { Appearance } from "./appearance";
import { BUILTIN_DRIVERS } from "./builtin/drivers";
import { hexToRgb, luminance } from "./color";
import { loadBundledFonts } from "./fonts";
import { FRONT_ENVIRONMENT, renderScale, sceneMode, type SceneEnvironment, type SceneMode } from "./guards";
import { mixLooks, resolveLook, type ResolvedLook } from "./look";
import { cardData, clearFromRect, windowCards, windowColumn, windowOpen, MAX_RIPPLES, RIPPLE_SECONDS, workerSeed, type ClearRect } from "./scene/contract";
import { LAYOUT_SETTLE_MS, cardSlots, LayoutWatch, measureLayout, openRect, type LayoutSample, type SceneInputs, type SceneLayout } from "./scene/layout";
import type { LiveUniforms, SceneDrivers, SceneLayer } from "./scene/live";
import { emptyRipples, emptyWorkers, SceneRenderer } from "./scene/renderer";
import type { Mode, ThemePackage } from "./schema";
import { NO_SIGNALS, needsYou, sceneEvents, workerSlots, type SceneSignals } from "./signals";
import { COLUMN_SELECTOR, CROSSFADE_ATTRIBUTE, EFFECTS_ATTRIBUTE, GLASS_ATTRIBUTE, HEADING_WEIGHT_ATTRIBUTE, lookTokens, STILL_ATTRIBUTE, THEME_ATTRIBUTE, THEME_CSS } from "./tokens";

export interface ShownTheme { key: string; theme: ThemePackage; appearance: Appearance }

export interface EngineDeps {
  root: HTMLElement;
  host: HTMLElement;
  createContext(canvas: HTMLCanvasElement): WebGLRenderingContext | null;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
  now(): number;
  size(): { width: number; height: number };
  column?(): { left: number; top: number; right: number; bottom: number } | null;
  layout?(): LayoutSample | null;
  every?(ms: number, run: () => void): () => void;
  scenes?: boolean;
  drivers?: SceneDrivers;
  publish?(look: ResolvedLook | null): void;
}

interface Layer {
  themeId: string;
  element: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  renderer: SceneRenderer | null;
  opacity: number;
  target: number;
  drawnStill: boolean;
  stale: boolean;
  live: LiveUniforms | null;
  image: SceneLayer | null;
  mode: Mode | null;
  stopDriver: (() => void) | null;
}

interface Ripple { x: number; y: number; start: number; kind: 1 | 2 }

export interface EngineSnapshot {
  themeId: string | null;
  mode: SceneMode;
  tokens: Record<string, string>;
  layers: { themeId: string; opacity: number; live: boolean }[];
  crossfading: boolean;
  frames: number;
  sceneTime: number;
  scale: number;
  clear: ClearRect | null;
  open: ClearRect | null;
  cards: ClearRect[];
  layout: SceneLayout | null;
  ripples: number;
  needsYou: number;
}

const STYLE_ID = "studio-theme-style";
const ATTRIBUTES = [THEME_ATTRIBUTE, EFFECTS_ATTRIBUTE, STILL_ATTRIBUTE, CROSSFADE_ATTRIBUTE, GLASS_ATTRIBUTE, HEADING_WEIGHT_ATTRIBUTE] as const;
const NEEDS_YOU_RATE = 2;
export const CLEAR_MEASURE_MS = 250;
const CLEAR_RATE = 5;
const NO_CARD: ClearRect = [0, 0, 0, 0];

export function effectList(appearance: Appearance): string {
  const on: string[] = [];
  if (appearance.effects.workers) on.push("workers");
  if (appearance.effects.finished) on.push("finished");
  if (appearance.effects.needsYou) on.push("needs-you");
  if (appearance.effects.error) on.push("error");
  return on.join(" ");
}

export function defaultEngineDeps(doc: Document = document): EngineDeps {
  const view = doc.defaultView ?? window;
  return {
    root: doc.documentElement,
    host: doc.body,
    createContext: (canvas) => {
      try { return canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "low-power" }) as WebGLRenderingContext | null; } catch { return null; }
    },
    requestFrame: (callback) => view.requestAnimationFrame(callback),
    cancelFrame: (handle) => view.cancelAnimationFrame(handle),
    now: () => view.performance.now(),
    size: () => ({ width: view.innerWidth, height: view.innerHeight }),
    column: () => {
      const rect = doc.querySelector(COLUMN_SELECTOR)?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
    },
    layout: () => measureLayout(doc),
    every: (ms, run) => {
      const handle = view.setInterval(run, ms);
      return () => view.clearInterval(handle);
    },
  };
}

export class ThemeEngine {
  private shown: ShownTheme | null = null;
  private mode: Mode = "dark";
  private target: ResolvedLook | null = null;
  private displayed: ResolvedLook | null = null;
  private fade: { from: ResolvedLook; start: number; ms: number } | null = null;
  private layers: Layer[] = [];
  private applied = new Set<string>();
  private tokens: Record<string, string> = {};
  private env: SceneEnvironment = FRONT_ENVIRONMENT;
  private signals: SceneSignals = NO_SIGNALS;
  private ripples: Ripple[] = [];
  private appeared = new Map<string, number>();
  private needsYouLevel = 0;
  private sceneTime = 0;
  private frames = 0;
  private handle: number | null = null;
  private last: number | null = null;
  private workers = emptyWorkers();
  private rippleData = emptyRipples();
  private clearShown: ClearRect | null = null;
  private clearTarget: ClearRect | null = null;
  private clearAt = Number.NEGATIVE_INFINITY;
  private openShown: ClearRect | null = null;
  private cardsShown: ClearRect[] = [];
  private layoutWatch = new LayoutWatch();
  private layoutListeners = new Set<() => void>();
  private stopLayout: (() => void) | null = null;
  private readonly inputs: SceneInputs = {
    layout: () => this.layoutWatch.current(),
    onLayout: (run) => { this.layoutListeners.add(run); return () => { this.layoutListeners.delete(run); }; },
  };
  private disposed = false;

  constructor(private readonly deps: EngineDeps) {
    const doc = deps.root.ownerDocument;
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement("style");
      style.id = STYLE_ID;
      style.textContent = THEME_CSS;
      doc.head.appendChild(style);
    }
  }

  show(next: ShownTheme | null, mode: Mode): void {
    if (this.disposed) return;
    const previous = this.shown;
    this.shown = next;
    this.mode = mode;
    if (!next) { this.clear(); return; }
    const sameTheme = previous?.theme.id === next.theme.id;
    if (!sameTheme) {
      this.sceneTime = 0;
      this.ripples = [];
      this.appeared.clear();
      this.swapLayer(next.theme, !!previous && !this.env.reducedMotion);
    }
    const look = this.resolve(next);
    if (previous && previous.key !== next.key && this.displayed && look.crossfadeMs > 0 && !this.env.reducedMotion) {
      this.fade = { from: this.displayed, start: this.deps.now(), ms: look.crossfadeMs };
    } else if (!this.fade) {
      this.displayed = look;
    }
    this.target = look;
    for (const layer of this.layers) layer.drawnStill = false;
    this.writeAttributes();
    if (!this.fade) this.applyTokens(look);
    this.wake();
  }

  private resolve(shown: ShownTheme): ResolvedLook {
    const top = this.top();
    const scene = shown.theme.scene;
    const unlit: Mode | null = top && !top.renderer && scene.kind === "shader" ? (luminance(hexToRgb(scene.fallback.color)) > 0.3 ? "light" : "dark") : null;
    const chosen = top?.mode ?? unlit;
    const driven = chosen !== null && !!shown.theme.variants[chosen];
    const look = resolveLook(shown.theme, shown.appearance, driven ? chosen : this.mode, this.env.reducedMotion);
    return driven ? { ...look, fixedMode: true } : look;
  }

  private sceneChoseMode(): void {
    const shown = this.shown;
    if (!shown || !this.target) return;
    const look = this.resolve(shown);
    if (look.mode === this.target.mode && look.fixedMode === this.target.fixedMode) return;
    if (this.displayed && look.crossfadeMs > 0) this.fade = { from: this.displayed, start: this.deps.now(), ms: look.crossfadeMs };
    else { this.fade = null; this.displayed = look; }
    this.target = look;
    this.writeAttributes();
    if (!this.fade) this.applyTokens(look);
  }

  setEnvironment(env: SceneEnvironment): void {
    const reduced = env.reducedMotion !== this.env.reducedMotion;
    this.env = env;
    if (reduced && this.shown) { this.show(this.shown, this.mode); return; }
    for (const layer of this.layers) layer.drawnStill = false;
    this.wake();
  }

  setSignals(next: SceneSignals): void {
    const events = sceneEvents(this.signals, next);
    this.signals = next;
    const appearance = this.shown?.appearance;
    const live = this.top()?.renderer;
    if (appearance && live && this.currentMode() === "run") {
      for (const event of events) {
        if (event.kind === "finished" && !appearance.effects.finished) continue;
        if (event.kind === "error" && !appearance.effects.error) continue;
        this.ripples.push({ x: event.x, y: event.y, start: this.sceneTime, kind: event.kind === "error" ? 2 : 1 });
      }
      this.ripples = this.ripples.slice(-MAX_RIPPLES);
    }
    for (const layer of this.layers) layer.drawnStill = false;
    this.wake();
  }

  snapshot(): EngineSnapshot {
    return {
      themeId: this.shown?.theme.id ?? null,
      mode: this.currentMode(),
      tokens: { ...this.tokens },
      layers: this.layers.map((layer) => ({ themeId: layer.themeId, opacity: Math.round(layer.opacity * 1000) / 1000, live: !!layer.renderer })),
      crossfading: !!this.fade,
      frames: this.frames,
      sceneTime: this.sceneTime,
      scale: renderScale(this.env),
      clear: this.clearShown,
      open: this.openShown,
      cards: this.cardsShown,
      layout: this.layoutWatch.current(),
      ripples: this.ripples.length,
      needsYou: this.needsYouLevel,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.clearTokens();
    for (const layer of this.layers) this.dropLayer(layer);
    this.layers = [];
    this.watchLayout();
    for (const name of ATTRIBUTES) this.deps.root.removeAttribute(name);
  }

  private sampleLayout(): void {
    const sample = this.deps.layout?.();
    if (!sample || !this.layoutWatch.sample(sample, this.deps.now())) return;
    for (const run of [...this.layoutListeners]) run();
  }

  private watchLayout(): void {
    const wanted = !this.disposed && this.layers.length > 0 && !!this.deps.layout && !!this.deps.every;
    if (wanted && !this.stopLayout) this.stopLayout = this.deps.every!(LAYOUT_SETTLE_MS, () => this.sampleLayout());
    if (!wanted && this.stopLayout) { this.stopLayout(); this.stopLayout = null; }
  }

  private currentMode(): SceneMode {
    return sceneMode(this.env, !!this.target?.still);
  }

  private top(): Layer | undefined {
    return this.layers.find((layer) => layer.target === 1);
  }

  private clear(): void {
    this.fade = null;
    this.target = null;
    this.displayed = null;
    this.clearTokens();
    for (const name of ATTRIBUTES) this.deps.root.removeAttribute(name);
    for (const layer of this.layers) layer.target = 0;
    if (this.env.reducedMotion) { for (const layer of this.layers) this.dropLayer(layer); this.layers = []; }
    this.watchLayout();
    this.wake();
  }

  private swapLayer(theme: ThemePackage, animate: boolean): void {
    for (const layer of this.layers) layer.target = 0;
    if (!animate) { for (const layer of this.layers) this.dropLayer(layer); this.layers = []; }
    if (theme.scene.kind !== "shader" || this.deps.scenes === false) { this.watchLayout(); return; }
    const doc = this.deps.host.ownerDocument;
    const element = doc.createElement("div");
    element.setAttribute("data-studio-scene-layer", "");
    element.setAttribute("data-theme-id", theme.id);
    element.style.background = theme.scene.fallback.image ? `${theme.scene.fallback.color} center / cover no-repeat url("${theme.scene.fallback.image}")` : theme.scene.fallback.color;
    const layer: Layer = { themeId: theme.id, element, canvas: null, renderer: null, opacity: animate ? 0 : 1, target: 1, drawnStill: false, stale: false, live: null, image: null, mode: null, stopDriver: null };
    element.style.opacity = String(layer.opacity);
    const canvas = doc.createElement("canvas");
    const gl = this.deps.createContext(canvas);
    if (gl) {
      const compiled = SceneRenderer.create(gl, theme.scene);
      if (compiled.ok) { layer.canvas = canvas; layer.renderer = compiled.renderer; element.appendChild(canvas); }
    }
    const driver = layer.renderer ? (this.deps.drivers ?? BUILTIN_DRIVERS)[theme.id] : undefined;
    this.deps.host.appendChild(element);
    this.layers.push(layer);
    this.sampleLayout();
    this.watchLayout();
    if (driver) layer.stopDriver = driver((uniforms, image, mode) => {
      layer.live = uniforms;
      if (image) layer.image = image;
      layer.drawnStill = false;
      layer.stale = true;
      if (mode !== undefined && mode !== layer.mode) { layer.mode = mode; if (this.target?.themeId === layer.themeId) this.sceneChoseMode(); }
      this.wake();
    }, this.inputs);
  }

  private dropLayer(layer: Layer): void {
    layer.stopDriver?.();
    layer.stopDriver = null;
    layer.renderer?.dispose();
    layer.element.remove();
  }

  private writeAttributes(): void {
    const root = this.deps.root;
    const look = this.target;
    const shown = this.shown;
    if (!look || !shown) return;
    root.setAttribute(THEME_ATTRIBUTE, shown.theme.id);
    const effects = effectList(shown.appearance);
    if (effects) root.setAttribute(EFFECTS_ATTRIBUTE, effects); else root.removeAttribute(EFFECTS_ATTRIBUTE);
    if (look.still) root.setAttribute(STILL_ATTRIBUTE, ""); else root.removeAttribute(STILL_ATTRIBUTE);
    if (look.glassy) root.setAttribute(GLASS_ATTRIBUTE, ""); else root.removeAttribute(GLASS_ATTRIBUTE);
    if (this.fade) root.setAttribute(CROSSFADE_ATTRIBUTE, ""); else root.removeAttribute(CROSSFADE_ATTRIBUTE);
    if (this.deps.publish) return;
    root.style.setProperty("color-scheme", look.mode);
    this.applied.add("color-scheme");
  }

  private applyTokens(look: ResolvedLook): void {
    const tokens = lookTokens(look);
    this.tokens = tokens;
    loadBundledFonts(this.deps.root.ownerDocument, [look.fonts.heading, look.fonts.body, look.fonts.mono, look.fonts.transcript]);
    if (look.fonts.headingWeight !== undefined) this.deps.root.setAttribute(HEADING_WEIGHT_ATTRIBUTE, String(look.fonts.headingWeight)); else this.deps.root.removeAttribute(HEADING_WEIGHT_ATTRIBUTE);
    if (this.deps.publish) { this.deps.publish(look); return; }
    const root = this.deps.root;
    for (const key of this.applied) if (!(key in tokens) && key !== "color-scheme") { root.style.removeProperty(key); this.applied.delete(key); }
    for (const [key, value] of Object.entries(tokens)) { root.style.setProperty(key, value); this.applied.add(key); }
  }

  private clearTokens(): void {
    this.tokens = {};
    this.deps.publish?.(null);
    for (const key of this.applied) this.deps.root.style.removeProperty(key);
    this.applied.clear();
  }

  private wake(): void {
    if (this.handle !== null || this.disposed) return;
    this.handle = this.deps.requestFrame(() => this.tick());
  }

  private stop(): void {
    if (this.handle !== null) this.deps.cancelFrame(this.handle);
    this.handle = null;
    this.last = null;
  }

  private tick(): void {
    this.handle = null;
    if (this.disposed) return;
    const now = this.deps.now();
    const dt = this.last === null ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    let busy = false;

    if (this.fade && this.target) {
      const t = this.fade.ms > 0 ? Math.min(1, (now - this.fade.start) / this.fade.ms) : 1;
      const eased = t * t * (3 - 2 * t);
      this.displayed = mixLooks(this.fade.from, this.target, eased);
      this.applyTokens(this.displayed);
      if (t >= 1) { this.fade = null; this.displayed = this.target; this.writeAttributes(); } else busy = true;
    }

    const fadeMs = Math.max(1, this.target?.crossfadeMs ?? this.fade?.ms ?? 400);
    for (const layer of this.layers) {
      if (layer.opacity === layer.target) continue;
      const step = dt > 0 ? (dt * 1000) / fadeMs : 0;
      layer.opacity = layer.target > layer.opacity ? Math.min(layer.target, layer.opacity + step) : Math.max(layer.target, layer.opacity - step);
      layer.element.style.opacity = String(layer.opacity);
      busy = true;
    }
    const gone = this.layers.filter((layer) => layer.target === 0 && layer.opacity === 0);
    for (const layer of gone) this.dropLayer(layer);
    this.layers = this.layers.filter((layer) => !gone.includes(layer));
    if (gone.length) this.watchLayout();

    const mode = this.currentMode();
    const look = this.displayed;
    if (look) {
      const target = this.shown?.appearance.effects.needsYou && needsYou(this.signals) ? 1 : 0;
      if (mode === "run") {
        this.sceneTime += dt * look.rate;
        this.needsYouLevel = target > this.needsYouLevel ? Math.min(target, this.needsYouLevel + dt * NEEDS_YOU_RATE) : Math.max(target, this.needsYouLevel - dt * NEEDS_YOU_RATE);
        if (this.needsYouLevel !== target) busy = true;
      } else {
        this.needsYouLevel = target;
      }
      this.ripples = this.ripples.filter((ripple) => this.sceneTime - ripple.start < RIPPLE_SECONDS);
      for (const layer of this.layers) {
        if (!layer.renderer || !layer.canvas) continue;
        const animating = layer.opacity !== layer.target;
        if (mode === "paused" && !animating && !layer.stale) continue;
        if (mode === "still" && layer.drawnStill && !animating) continue;
        this.draw(layer, look, mode, dt);
        if (mode === "run") busy = true;
      }
    }
    if (busy) this.wake();
    else this.last = null;
  }

  private measureClear(size: { width: number; height: number }, canvas: { width: number; height: number }, mode: SceneMode, dt: number): ClearRect {
    const now = this.deps.now();
    if (!this.clearTarget || mode !== "run" || now - this.clearAt >= CLEAR_MEASURE_MS) {
      this.clearAt = now;
      this.clearTarget = clearFromRect(windowColumn(size), size, canvas);
    }
    const target = this.clearTarget;
    const from = this.clearShown;
    if (!from || mode !== "run") this.clearShown = target;
    else {
      const step = Math.min(1, dt * CLEAR_RATE);
      const ease = (index: 0 | 1 | 2 | 3) => from[index] + (target[index] - from[index]) * step;
      this.clearShown = [ease(0), ease(1), ease(2), ease(3)];
    }
    return this.clearShown;
  }

  private measureOpen(size: { width: number; height: number }, canvas: { width: number; height: number }, mode: SceneMode, dt: number): { open: ClearRect; cards: Float32Array } {
    const layout = this.layoutWatch.current();
    const measured = layout && layout.width > 0 && layout.height > 0 ? layout : null;
    const view = measured ?? size;
    const rect = measured ? openRect(measured) : windowOpen(size);
    const boxes = measured ? cardSlots(measured) : windowCards(size);
    const step = mode === "run" ? Math.min(1, dt * CLEAR_RATE) : 1;
    const ease = (from: ClearRect, target: ClearRect): ClearRect => [0, 1, 2, 3].map((index) => from[index]! + (target[index]! - from[index]!) * step) as unknown as ClearRect;
    const shown = this.openShown;
    const middle = shown ? (shown[0] + shown[2]) / 2 : 0;
    const target: ClearRect = rect ? clearFromRect(rect, view, canvas) : [middle, shown?.[1] ?? 0, middle, shown?.[3] ?? 0];
    this.openShown = shown ? ease(shown, target) : target;
    this.cardsShown = boxes.map((box, index) => {
      const from = this.cardsShown[index];
      if (!box) return NO_CARD;
      const to = clearFromRect(box, view, canvas);
      return from && from !== NO_CARD ? ease(from, to) : to;
    });
    return { open: this.openShown, cards: cardData(this.cardsShown) };
  }

  private draw(layer: Layer, look: ResolvedLook, mode: SceneMode, dt: number): void {
    const theme = this.shown?.theme;
    const scene = theme?.scene.kind === "shader" && theme.id === layer.themeId ? theme.scene : null;
    const size = this.deps.size();
    const scale = renderScale(this.env);
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    const canvas = layer.canvas!;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const still = mode === "still";
    const time = still && scene ? scene.still : this.sceneTime;
    this.fillWorkers(time, still);
    this.fillRipples(still);
    layer.renderer!.draw({
      time,
      width,
      height,
      intensity: look.intensity,
      motion: look.motion,
      palette: look.palette,
      workers: this.workers,
      ripples: this.rippleData,
      needsYou: this.needsYouLevel,
      workerColor: look.worker,
      needsYouColor: look.needsYou,
      finishedColor: look.finished,
      errorColor: look.ripple,
      clear: this.measureClear(size, canvas, mode, dt),
      ...this.measureOpen(size, canvas, mode, dt),
      uniforms: layer.live,
      layer: layer.image,
    });
    layer.drawnStill = still;
    layer.stale = false;
    this.frames += 1;
  }

  private fillWorkers(time: number, still: boolean): void {
    this.workers.fill(0);
    if (!this.shown?.appearance.effects.workers) return;
    const slots = workerSlots(this.signals.workers);
    for (const id of [...this.appeared.keys()]) if (!slots.has(id)) this.appeared.delete(id);
    for (const [threadId, slot] of slots) {
      if (!this.appeared.has(threadId)) this.appeared.set(threadId, this.sceneTime);
      const age = still ? slot * 3 : Math.max(0, time - this.appeared.get(threadId)!);
      this.workers.set([workerSeed(slot), age, 1, 0], slot * 4);
    }
  }

  private fillRipples(still: boolean): void {
    this.rippleData.fill(0);
    if (still) return;
    this.ripples.forEach((ripple, index) => this.rippleData.set([ripple.x, ripple.y, this.sceneTime - ripple.start, ripple.kind], index * 4));
  }
}

export function accentOf(theme: ThemePackage | null, mode: Mode): string | null {
  if (!theme) return null;
  const variant = theme.variants[mode] ?? theme.variants.dark ?? theme.variants.light;
  return variant ? variant.accent : null;
}
