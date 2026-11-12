import { hexToRgb, type Rgb } from "../color";
import { workerSeed } from "../scene/contract";
import { browserGardenCanvas, gardenPainter } from "../kyoto/driver";
import type { KyotoUniforms } from "../kyoto/scene";
import type { SceneLayer } from "../scene/live";
import { emptyRipples, emptyWorkers, SceneRenderer } from "../scene/renderer";
import type { ShaderScene, ThemePackage } from "../schema";

export const PREVIEW_SIZE = { width: 240, height: 150 } as const;
export const LIVE_BUDGET = 1;

export interface BudgetInput {
  order: readonly string[];
  visible: ReadonlySet<string>;
  hovered: string | null;
  selected: string | null;
  reducedMotion: boolean;
  hidden: boolean;
  budget?: number;
}

export function livePreviews(input: BudgetInput): string[] {
  if (input.reducedMotion || input.hidden) return [];
  const budget = input.budget ?? LIVE_BUDGET;
  const wanted = [input.hovered, input.selected].filter((id): id is string => !!id && input.order.includes(id) && input.visible.has(id));
  return [...new Set(wanted)].slice(0, budget);
}

export interface PreviewDeps {
  createContext(width: number, height: number): { gl: WebGLRenderingContext; canvas: HTMLCanvasElement } | null;
  paint(target: HTMLCanvasElement, source: HTMLCanvasElement): void;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
  now(): number;
  layer?(theme: ThemePackage): SceneLayer | null;
}

export function previewLayers(): (theme: ThemePackage) => SceneLayer | null {
  const paint = gardenPainter(browserGardenCanvas);
  let garden: SceneLayer | null = null;
  return (theme) => {
    if (theme.id !== "kyoto-garden" || theme.scene.kind !== "shader") return null;
    garden = paint(theme.scene.uniforms as unknown as KyotoUniforms) ?? garden;
    return garden;
  };
}

export function browserPreviewDeps(doc: Document = document): PreviewDeps {
  const view = doc.defaultView ?? window;
  return {
    createContext: (width, height) => {
      if (typeof view.WebGLRenderingContext !== "function") return null;
      const canvas = doc.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      let gl: WebGLRenderingContext | null = null;
      try { gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: "low-power" }) as WebGLRenderingContext | null; } catch { gl = null; }
      return gl ? { gl, canvas } : null;
    },
    paint: (target, source) => {
      const context = target.getContext("2d");
      if (context) context.drawImage(source, 0, 0, target.width, target.height);
    },
    requestFrame: (callback) => view.requestAnimationFrame(callback),
    cancelFrame: (handle) => view.cancelAnimationFrame(handle),
    now: () => view.performance.now(),
    layer: previewLayers(),
  };
}

interface Card { id: string; theme: ThemePackage; scene: ShaderScene; target: HTMLCanvasElement; visible: boolean; still: boolean }

export interface PreviewSnapshot { live: string[]; stills: string[]; frames: number }

export class PreviewHub {
  private readonly cards = new Map<string, Card>();
  private readonly order: string[] = [];
  private context: { gl: WebGLRenderingContext; canvas: HTMLCanvasElement } | null | undefined;
  private readonly renderers = new Map<string, SceneRenderer | null>();
  private hovered: string | null = null;
  private selected: string | null = null;
  private reducedMotion = false;
  private hidden = false;
  private live: string[] = [];
  private handle: number | null = null;
  private start = 0;
  private frames = 0;
  private disposed = false;
  private readonly workers = emptyWorkers();
  private readonly ripples = emptyRipples();

  constructor(private readonly deps: PreviewDeps) {}

  register(theme: ThemePackage, target: HTMLCanvasElement): () => void {
    if (theme.scene.kind !== "shader") return () => {};
    const card: Card = { id: theme.id, theme, scene: theme.scene, target, visible: true, still: false };
    target.width = PREVIEW_SIZE.width;
    target.height = PREVIEW_SIZE.height;
    this.cards.set(theme.id, card);
    if (!this.order.includes(theme.id)) this.order.push(theme.id);
    this.update();
    return () => {
      if (this.cards.get(theme.id) !== card) return;
      this.cards.delete(theme.id);
      this.order.splice(this.order.indexOf(theme.id), 1);
      this.update();
    };
  }

  setVisible(id: string, visible: boolean): void {
    const card = this.cards.get(id);
    if (!card || card.visible === visible) return;
    card.visible = visible;
    this.update();
  }

  setHovered(id: string | null): void { if (this.hovered !== id) { this.hovered = id; this.update(); } }
  setSelected(id: string | null): void { if (this.selected !== id) { this.selected = id; this.update(); } }
  setReducedMotion(on: boolean): void { if (this.reducedMotion !== on) { this.reducedMotion = on; this.update(); } }
  setHidden(on: boolean): void { if (this.hidden !== on) { this.hidden = on; this.update(); } }

  snapshot(): PreviewSnapshot {
    return { live: this.live.slice(), stills: [...this.cards.values()].filter((card) => card.still).map((card) => card.id), frames: this.frames };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.handle !== null) this.deps.cancelFrame(this.handle);
    this.handle = null;
    for (const renderer of this.renderers.values()) renderer?.dispose();
    this.renderers.clear();
    this.context?.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.context = null;
    this.cards.clear();
  }

  private gl(): { gl: WebGLRenderingContext; canvas: HTMLCanvasElement } | null {
    if (this.context === undefined) this.context = this.deps.createContext(PREVIEW_SIZE.width, PREVIEW_SIZE.height);
    return this.context;
  }

  private renderer(card: Card): SceneRenderer | null {
    if (this.renderers.has(card.id)) return this.renderers.get(card.id)!;
    const context = this.gl();
    const compiled = context ? SceneRenderer.create(context.gl, card.scene) : null;
    const renderer = compiled?.ok ? compiled.renderer : null;
    this.renderers.set(card.id, renderer);
    return renderer;
  }

  private draw(card: Card, time: number, running: number): boolean {
    const context = this.gl();
    const renderer = context ? this.renderer(card) : null;
    if (!context || !renderer) return false;
    const theme = card.theme;
    const variant = theme.variants.dark ?? theme.variants.light!;
    this.workers.fill(0);
    this.workers.set([workerSeed(0), running, 1, 0], 0);
    renderer.draw({
      time, width: PREVIEW_SIZE.width, height: PREVIEW_SIZE.height, intensity: theme.defaults.intensity, motion: theme.defaults.motion,
      palette: theme.palette.map(hexToRgb) as [Rgb, Rgb, Rgb, Rgb],
      workers: this.workers, ripples: this.ripples, needsYou: 0,
      workerColor: hexToRgb(theme.effects.worker.color), needsYouColor: hexToRgb(theme.effects.needsYou.color),
      finishedColor: hexToRgb(theme.effects.finished.color), errorColor: hexToRgb(variant.error),
      layer: this.deps.layer?.(theme) ?? null,
    });
    this.deps.paint(card.target, context.canvas);
    return true;
  }

  private update(): void {
    if (this.disposed) return;
    const visible = new Set([...this.cards.values()].filter((card) => card.visible).map((card) => card.id));
    const next = livePreviews({ order: this.order, visible, hovered: this.hovered, selected: this.selected, reducedMotion: this.reducedMotion, hidden: this.hidden });
    const started = next.some((id) => !this.live.includes(id));
    const stopped = this.live.filter((id) => !next.includes(id));
    this.live = next;
    for (const id of stopped) { const card = this.cards.get(id); if (card) card.still = false; }
    if (!this.hidden) {
      for (const card of this.cards.values()) {
        if (!card.visible || card.still || this.live.includes(card.id)) continue;
        card.still = this.draw(card, card.scene.still, 4);
      }
    }
    if (started) this.start = this.deps.now();
    if (this.live.length && this.handle === null) this.handle = this.deps.requestFrame((time) => this.frame(time));
    if (!this.live.length && this.handle !== null) { this.deps.cancelFrame(this.handle); this.handle = null; }
  }

  private frame(_time: number): void {
    this.handle = null;
    if (this.disposed || !this.live.length) return;
    const elapsed = (this.deps.now() - this.start) / 1000;
    for (const id of this.live) {
      const card = this.cards.get(id);
      if (!card) continue;
      const rate = card.theme.motion.speed * card.theme.defaults.motion;
      this.draw(card, card.scene.still + elapsed * rate, 4 + elapsed);
    }
    this.frames += 1;
    this.handle = this.deps.requestFrame((time) => this.frame(time));
  }
}
