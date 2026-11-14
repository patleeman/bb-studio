// The phone's look renderer. ios/scripts/build-look.mjs bundles this with
// desktop's scene engine, scene drivers and presence forms into
// iOS/Look/Resources/look.js. It runs only inside the app's sandboxed WKWebView
// (iOS/Look/LookWebView.swift): no network, one custom scheme, no navigation.
import { BUILTIN_DRIVERS } from "../../../plugins/packages/bb-studio/src/theme/builtin/drivers";
import { renderScale } from "../../../plugins/packages/bb-studio/src/theme/guards";
import { resolveLook, type ResolvedLook } from "../../../plugins/packages/bb-studio/src/theme/look";
import { BUILTIN_THEMES, canonicalThemeId } from "../../../plugins/packages/bb-studio/src/theme/registry";
import { cardData, clearFromRect, MAX_RIPPLES, RIPPLE_SECONDS, workerSeed, type ClearRect } from "../../../plugins/packages/bb-studio/src/theme/scene/contract";
import type { SceneLayout } from "../../../plugins/packages/bb-studio/src/theme/scene/layout";
import type { LiveUniforms, SceneLayer } from "../../../plugins/packages/bb-studio/src/theme/scene/live";
import { emptyRipples, emptyWorkers, SceneRenderer } from "../../../plugins/packages/bb-studio/src/theme/scene/renderer";
import type { Mode, ShaderScene, ThemePackage } from "../../../plugins/packages/bb-studio/src/theme/schema";
import { NO_SIGNALS, needsYou, sceneEvents, workerSlots, type SceneSignals } from "../../../plugins/packages/bb-studio/src/theme/signals";
import { AMBER, AMBER_LIGHT, drawPresence, isBuiltinForm, STATE_SPEED, type Palette, type PresenceStateName } from "../../../plugins/packages/bb-studio/src/presence/forms";
import { haloFilter } from "../../../plugins/packages/bb-studio/src/presence/halo";
import { presenceLook } from "../../../plugins/packages/bb-studio/src/presence/look";
import { paletteHex } from "../../../plugins/packages/bb-studio/src/presence/palette";
import { PresenceSandbox } from "../../../plugins/packages/bb-studio/src/presence/sandbox";
import { FALLBACK_FORM } from "../../../plugins/packages/bb-studio/src/presence/schema";
import { ON_AIR } from "./on-air";

type Post = (message: Record<string, unknown>) => void;
const post: Post = (message) => {
  const handler = (window as unknown as { webkit?: { messageHandlers?: { bbLook?: { postMessage(m: unknown): void } } } }).webkit?.messageHandlers?.bbLook;
  handler?.postMessage(message);
};

const THEMES: readonly ThemePackage[] = [ON_AIR, ...BUILTIN_THEMES];
const themeById = (id: string | null | undefined): ThemePackage | null => (id ? THEMES.find((theme) => theme.id === canonicalThemeId(id)) ?? null : null);

// ---------------------------------------------------------------- scenes

/** Rectangles in CSS pixels, top-left origin, like desktop's layout. */
interface Rect { left: number; top: number; right: number; bottom: number }

export interface SceneStart {
  themeId: string;
  mode: Mode;
  width: number;
  height: number;
  dpr: number;
  live: boolean;
  fps: number;
  /** Where text sits (the list or the transcript column): the scene fades there. */
  column: Rect;
  /** The open area for the scene's focal object. */
  open: Rect | null;
  cards: Rect[];
  signals?: SceneSignals;
  intensity?: number;
  glass?: number;
  motion?: number;
  /** Most milliseconds to wait for a driver's first picture before a still. */
  settleMs?: number;
}

interface Ripple { x: number; y: number; start: number; kind: number }
const NEEDS_YOU_RATE = 1.6;

class PhoneScene {
  readonly canvas: HTMLCanvasElement;
  private renderer: SceneRenderer | null = null;
  private readonly theme: ThemePackage;
  private readonly scene: ShaderScene;
  private look: ResolvedLook;
  private live: LiveUniforms | null = null;
  private image: SceneLayer | null = null;
  private stopDriver: (() => void) | null = null;
  private time: number;
  private workers = emptyWorkers();
  private ripples: Ripple[] = [];
  private rippleData = emptyRipples();
  private appeared = new Map<string, number>();
  private needsLevel = 0;
  private signals: SceneSignals;
  private handle: number | null = null;
  private last: number | null = null;
  private lastDraw = 0;
  private published = 0;
  private lastPublish = 0;
  frames = 0;
  drawMs = 0;
  error: string | null = null;

  constructor(private options: SceneStart) {
    const theme = themeById(options.themeId);
    if (!theme || theme.scene.kind !== "shader") throw new Error(`No scene theme ${options.themeId}`);
    this.theme = theme;
    this.scene = theme.scene;
    this.time = theme.scene.still;
    this.signals = options.signals ?? NO_SIGNALS;
    this.look = resolveLook(theme, { intensity: options.intensity ?? theme.defaults.intensity, glass: options.glass ?? theme.defaults.glass, motion: options.motion ?? theme.defaults.motion }, options.mode);
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block";
    document.body.appendChild(this.canvas);
    this.resize(options.width, options.height, options.dpr);
    const gl = this.canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" }) as WebGLRenderingContext | null;
    if (!gl) { this.error = "No WebGL"; return; }
    const compiled = SceneRenderer.create(gl, this.scene);
    if (!compiled.ok) { this.error = compiled.error; return; }
    this.renderer = compiled.renderer;
    const driver = BUILTIN_DRIVERS[theme.id];
    const layout = (): SceneLayout => ({ width: this.options.width, height: this.options.height, sidebar: 0, panel: null });
    if (driver) this.stopDriver = driver((uniforms, image, mode) => {
      this.live = uniforms;
      if (image) this.image = image;
      this.published += 1;
      this.lastPublish = performance.now();
      if (mode !== undefined) post({ kind: "scene-mode", mode });
      if (this.handle === null && !this.options.live) this.drawOnce();
    }, { layout, onLayout: () => () => {} });
  }

  get hasDriver(): boolean { return !!BUILTIN_DRIVERS[this.theme.id]; }

  resize(width: number, height: number, dpr: number): void {
    this.options = { ...this.options, width, height, dpr };
    const scale = renderScale({ onBattery: false, batteryLevel: 1, pixelRatio: dpr });
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  setSignals(next: SceneSignals): void {
    const events = sceneEvents(this.signals, next);
    this.signals = next;
    if (this.options.live) {
      for (const event of events) {
        this.ripples.push({ x: event.x, y: event.y, start: this.time, kind: event.kind === "error" ? 1 : 0 });
        if (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
      }
    } else this.drawOnce();
  }

  private clearRects(): { clear: ClearRect; open: ClearRect; cards: Float32Array } {
    const view = { width: this.options.width, height: this.options.height };
    const canvas = { width: this.canvas.width, height: this.canvas.height };
    const clear = clearFromRect(this.options.column, view, canvas);
    const open: ClearRect = this.options.open ? clearFromRect(this.options.open, view, canvas) : [clear[2], clear[1], clear[2], clear[3]];
    return { clear, open, cards: cardData(this.options.cards.map((card) => clearFromRect(card, view, canvas))) };
  }

  private fillWorkers(still: boolean): void {
    this.workers.fill(0);
    const slots = workerSlots(this.signals.workers);
    for (const id of [...this.appeared.keys()]) if (!slots.has(id)) this.appeared.delete(id);
    for (const [threadId, slot] of slots) {
      if (!this.appeared.has(threadId)) this.appeared.set(threadId, this.time);
      const age = still ? slot * 3 : Math.max(0, this.time - this.appeared.get(threadId)!);
      this.workers.set([workerSeed(slot), age, 1, 0], slot * 4);
    }
  }

  private fillRipples(still: boolean): void {
    this.rippleData.fill(0);
    this.ripples = this.ripples.filter((ripple) => this.time - ripple.start < RIPPLE_SECONDS);
    if (still) return;
    this.ripples.forEach((ripple, index) => this.rippleData.set([ripple.x, ripple.y, this.time - ripple.start, ripple.kind], index * 4));
  }

  private draw(still: boolean): void {
    if (!this.renderer) return;
    const started = performance.now();
    if (still) { this.time = this.scene.still; this.needsLevel = needsYou(this.signals) ? 1 : 0; }
    this.fillWorkers(still);
    this.fillRipples(still);
    const look = this.look;
    this.renderer.draw({
      time: this.time, width: this.canvas.width, height: this.canvas.height, intensity: look.intensity, motion: look.motion, palette: look.palette,
      workers: this.workers, ripples: this.rippleData, needsYou: this.needsLevel,
      workerColor: look.worker, needsYouColor: look.needsYou, finishedColor: look.finished, errorColor: look.ripple,
      ...this.clearRects(), uniforms: this.live, layer: this.image,
    });
    this.frames += 1;
    this.drawMs += performance.now() - started;
  }

  drawOnce(): void { this.draw(true); }

  /** Waits for the driver's picture (or settleMs), draws the still frame and returns it as a JPEG data URL. */
  async still(): Promise<string> {
    if (this.error || !this.renderer) throw new Error(this.error ?? "No renderer");
    const settle = this.options.settleMs ?? 2500;
    const started = performance.now();
    if (this.hasDriver) {
      await new Promise<void>((resolve) => {
        const check = () => {
          const now = performance.now();
          if (now - started >= settle || (this.published > 0 && now - this.lastPublish >= 400)) resolve();
          else setTimeout(check, 50);
        };
        check();
      });
    }
    this.draw(true);
    return this.canvas.toDataURL("image/jpeg", 0.9);
  }

  start(): void {
    if (!this.options.live || this.handle !== null || !this.renderer) { this.drawOnce(); return; }
    this.last = null;
    this.handle = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (this.handle !== null) cancelAnimationFrame(this.handle);
    this.handle = null;
    this.last = null;
  }

  setLive(live: boolean, fps?: number): void {
    this.options = { ...this.options, live, fps: fps ?? this.options.fps };
    if (live) this.start(); else { this.pause(); this.drawOnce(); }
  }

  private readonly tick = (now: number): void => {
    this.handle = requestAnimationFrame(this.tick);
    const interval = 1000 / Math.max(1, Math.min(60, this.options.fps || 30));
    if (now - this.lastDraw < interval - 2) return;
    this.lastDraw = now;
    const dt = this.last === null ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt * this.look.rate;
    const target = needsYou(this.signals) ? 1 : 0;
    this.needsLevel = target > this.needsLevel ? Math.min(target, this.needsLevel + dt * NEEDS_YOU_RATE) : Math.max(target, this.needsLevel - dt * NEEDS_YOU_RATE);
    this.draw(false);
  };

  stats(): { frames: number; drawMs: number; live: boolean; running: boolean } {
    return { frames: this.frames, drawMs: this.drawMs, live: this.options.live, running: this.handle !== null };
  }

  dispose(): void {
    this.pause();
    this.stopDriver?.();
    this.stopDriver = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas.remove();
  }
}

let current: PhoneScene | null = null;

const scene = {
  start(options: SceneStart): { ok: boolean; error?: string; driver: boolean } {
    current?.dispose();
    current = null;
    try {
      current = new PhoneScene(options);
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error), driver: false };
    }
    if (current.error) return { ok: false, error: current.error, driver: current.hasDriver };
    current.start();
    return { ok: true, driver: current.hasDriver };
  },
  still: (): Promise<string> => (current ? current.still() : Promise.reject(new Error("No scene"))),
  setSignals: (signals: SceneSignals) => current?.setSignals(signals),
  setLive: (live: boolean, fps?: number) => current?.setLive(live, fps),
  resize: (width: number, height: number, dpr: number) => { current?.resize(width, height, dpr); current?.setLive(false); },
  pause: () => current?.pause(),
  resume: () => current?.start(),
  stats: () => current?.stats() ?? null,
  stop: () => { current?.dispose(); current = null; },
};

// ---------------------------------------------------------------- presence

export interface PresenceSpec {
  form: string;
  /** An agent-made form's module, from presences_list. */
  code?: string | null;
  themeId?: string | null;
  mode: Mode;
  customHex?: string | null;
  motion?: number;
  state: PresenceStateName;
  workers: number;
  size: number;
  room?: number;
  time?: number;
  dpr: number;
  /** The surface's ink, for desktop's light-theme halo. */
  ink: string;
  surfaceLight: boolean;
}

const START_TIME = 5.5;
/** A still is drawn once, often while the phone is busy: desktop's limits, with room for a cold start. */
const STILL_TIMING = { startMs: 4000, frameMs: 1500, readyMs: 6000, ackMs: 3000 } as const;
const CUSTOM_STEP = 1 / 31;

function lookFor(spec: PresenceSpec): { palette: Palette; light: boolean } {
  const color = spec.customHex ? { source: "custom" as const, hex: spec.customHex } : { source: "theme" as const };
  return presenceLook({ color }, themeById(spec.themeId ?? null), spec.mode);
}

function canvasSize(spec: PresenceSpec): number {
  return spec.size * Math.max(1, spec.room ?? 1);
}

function roomy(ctx: CanvasRenderingContext2D, spec: PresenceSpec): CanvasRenderingContext2D {
  const off = ((canvasSize(spec) - spec.size) / 2) * spec.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (off === 0) return ctx;
  return new Proxy(ctx, {
    get(target, key) {
      if (key === "setTransform") {
        return (a: number, b: number, c: number, d: number, e: number, f: number) => target.setTransform(a, b, c, d, e + off, f + off);
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) { return Reflect.set(target, key, value, target); },
  });
}

function formOf(spec: PresenceSpec): string {
  if (spec.code) return spec.form;
  return isBuiltinForm(spec.form) ? spec.form : FALLBACK_FORM;
}

const resolvedHalo = (spec: PresenceSpec, palette: Palette, clock: number): string =>
  haloFilter({ surfaceLight: spec.surfaceLight, state: spec.state, size: spec.size, clock, palette }).replace(/var\(--ink\)/g, spec.ink);

function withHalo(source: HTMLCanvasElement | OffscreenCanvas, spec: PresenceSpec, palette: Palette): string {
  const filter = resolvedHalo(spec, palette, 0);
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d")!;
  if (filter !== "none" && "filter" in ctx) ctx.filter = filter;
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  return out.toDataURL("image/png");
}

class LivePresence {
  private spec: PresenceSpec;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private sandbox: PresenceSandbox | null = null;
  private holder: HTMLElement | null = null;
  private clock = { real: 0, form: START_TIME, due: 0 };
  private handle: number | null = null;
  private last: number | null = null;
  private lastDraw = 0;
  private palette: Palette;
  private light: boolean;
  frames = 0;
  drawMs = 0;

  constructor(spec: PresenceSpec, private live: boolean, private fps: number) {
    this.spec = spec;
    ({ palette: this.palette, light: this.light } = lookFor(spec));
    document.documentElement.style.setProperty("--ink", spec.ink);
    if (spec.code) {
      const holder = document.createElement("span");
      holder.style.cssText = `position:fixed;left:0;top:0;width:${canvasSize(spec)}px;height:${canvasSize(spec)}px;display:block`;
      document.body.appendChild(holder);
      this.holder = holder;
      this.sandbox = new PresenceSandbox({
        code: spec.code, document,
        onFail: (reason) => post({ kind: "presence-fail", reason }),
        onReady: () => this.paint(),
        onFrame: () => { this.frames += 1; },
      });
      holder.append(this.sandbox.frame);
    } else {
      const canvas = document.createElement("canvas");
      canvas.style.cssText = `position:fixed;left:0;top:0;width:${canvasSize(spec)}px;height:${canvasSize(spec)}px;display:block`;
      document.body.appendChild(canvas);
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.sizeCanvas();
      this.paint();
    }
    if (live) this.start();
  }

  private sizeCanvas(): void {
    if (!this.canvas) return;
    const px = Math.round(canvasSize(this.spec) * this.spec.dpr);
    if (this.canvas.width !== px) { this.canvas.width = px; this.canvas.height = px; }
    this.canvas.style.width = this.canvas.style.height = `${canvasSize(this.spec)}px`;
  }

  private paint(): void {
    const spec = this.spec;
    const started = performance.now();
    if (this.ctx && this.canvas) {
      drawPresence(roomy(this.ctx, spec), { form: formOf(spec) as never, size: spec.size, dpr: spec.dpr, clock: this.clock.real, formTime: this.clock.form, state: spec.state, workers: spec.workers, palette: this.palette, light: this.light });
      this.canvas.style.filter = haloFilter({ surfaceLight: spec.surfaceLight, state: spec.state, size: spec.size, clock: this.clock.real, palette: this.palette }).replace(/^none$/, "");
      this.frames += 1;
    } else if (this.sandbox?.ready) {
      this.sandbox.tick({
        size: spec.size, dpr: spec.dpr, t: this.clock.form,
        state: { name: spec.state, workers: spec.workers, clock: this.clock.real },
        palette: paletteHex(spec.state === "needs" ? (this.light ? AMBER_LIGHT : AMBER) : this.palette),
      });
      if (this.holder) this.holder.style.filter = haloFilter({ surfaceLight: spec.surfaceLight, state: spec.state, size: spec.size, clock: this.clock.real, palette: this.palette }).replace(/^none$/, "");
    }
    this.drawMs += performance.now() - started;
  }

  update(next: Partial<PresenceSpec>): void {
    this.spec = { ...this.spec, ...next };
    ({ palette: this.palette, light: this.light } = lookFor(this.spec));
    document.documentElement.style.setProperty("--ink", this.spec.ink);
    this.sizeCanvas();
    this.paint();
  }

  setLive(live: boolean, fps?: number): void {
    this.live = live;
    if (fps) this.fps = fps;
    if (live) this.start(); else this.pause();
  }

  private start(): void {
    if (this.handle !== null) return;
    this.last = null;
    this.handle = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (this.handle !== null) cancelAnimationFrame(this.handle);
    this.handle = null;
  }

  private readonly tick = (now: number): void => {
    this.handle = requestAnimationFrame(this.tick);
    if (now - this.lastDraw < 1000 / Math.max(1, Math.min(60, this.fps)) - 2) return;
    this.lastDraw = now;
    const dt = this.last === null ? 0 : Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock.real += dt;
    this.clock.form += dt * STATE_SPEED[this.spec.state] * (this.spec.motion ?? 1);
    if (this.sandbox) {
      this.clock.due += dt;
      if (this.clock.due < CUSTOM_STEP) return;
      this.clock.due = 0;
    }
    this.paint();
  };

  stats(): { frames: number; drawMs: number; running: boolean } {
    return { frames: this.frames, drawMs: this.drawMs, running: this.handle !== null };
  }

  dispose(): void {
    this.pause();
    this.sandbox?.dispose();
    this.holder?.remove();
    this.canvas?.remove();
  }
}

function stillBuiltin(spec: PresenceSpec): string {
  const { palette, light } = lookFor(spec);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(canvasSize(spec) * spec.dpr);
  canvas.height = canvas.width;
  const ctx = canvas.getContext("2d")!;
  drawPresence(roomy(ctx, spec), { form: formOf(spec) as never, size: spec.size, dpr: spec.dpr, clock: spec.time ?? 0, formTime: spec.time ?? START_TIME, state: spec.state, workers: spec.workers, palette, light });
  return withHalo(canvas, spec, palette);
}

function stillCustom(spec: PresenceSpec): Promise<string> {
  const { palette, light } = lookFor(spec);
  return new Promise((resolve, reject) => {
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-400px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(holder);
    const sandbox: PresenceSandbox = new PresenceSandbox({
      code: spec.code!, document, timing: STILL_TIMING,
      onFail: (reason) => { holder.remove(); reject(new Error(reason)); },
      onReady: () => {
        sandbox.tick({ size: spec.size, dpr: spec.dpr, t: START_TIME, state: { name: spec.state, workers: spec.workers, clock: 0 }, palette: paletteHex(spec.state === "needs" ? (light ? AMBER_LIGHT : AMBER) : palette), read: true });
      },
      onFrame: (frame) => {
        sandbox.dispose();
        holder.remove();
        if (!frame.pixels || !frame.width || !frame.height) { reject(new Error("No pixels")); return; }
        const canvas = document.createElement("canvas");
        canvas.width = frame.width;
        canvas.height = frame.height;
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
        resolve(withHalo(canvas, spec, palette));
      },
    });
    holder.append(sandbox.frame);
  });
}

let presenceNow: LivePresence | null = null;

const presence = {
  mount(spec: PresenceSpec, live: boolean, fps = 30): void {
    presenceNow?.dispose();
    presenceNow = new LivePresence(spec, live, fps);
  },
  update: (next: Partial<PresenceSpec>) => presenceNow?.update(next),
  setLive: (live: boolean, fps?: number) => presenceNow?.setLive(live, fps),
  pause: () => presenceNow?.pause(),
  stats: () => presenceNow?.stats() ?? null,
  stop: () => { presenceNow?.dispose(); presenceNow = null; },
  /** One still per call, as a PNG data URL: builtin forms drawn here, agent-made ones in desktop's sandbox. */
  still: async (spec: PresenceSpec): Promise<string> => (spec.code ? stillCustom(spec) : stillBuiltin(spec)),
};

(window as unknown as { BBLook: unknown }).BBLook = { scene, presence };
post({ kind: "ready" });
