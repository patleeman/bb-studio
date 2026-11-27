import { hexToRgb, type Rgb } from "../color";
import type { ShaderScene, UniformValue } from "../schema";
import { defaultCards, defaultClear, defaultOpen, fragmentSource, MAX_RIPPLES, MAX_WORKERS, VERTEX_SOURCE, type ClearRect } from "./contract";
import type { LiveUniforms, SceneLayer } from "./live";

export interface SceneFrame {
  time: number;
  width: number;
  height: number;
  intensity: number;
  motion: number;
  palette: readonly [Rgb, Rgb, Rgb, Rgb];
  workers: Float32Array;
  ripples: Float32Array;
  needsYou: number;
  workerColor: Rgb;
  needsYouColor: Rgb;
  finishedColor: Rgb;
  errorColor: Rgb;
  clear?: ClearRect | null;
  open?: ClearRect | null;
  cards?: Float32Array | null;
  uniforms?: LiveUniforms | null;
  layer?: SceneLayer | null;
  light?: readonly [number, number, number, number] | null;
}

export type CompiledScene = { ok: true; renderer: SceneRenderer } | { ok: false; error: string };

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | string {
  const shader = gl.createShader(type);
  if (!shader) return "No shader";
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const log = gl.getShaderInfoLog(shader) || "Shader didn't compile";
  gl.deleteShader(shader);
  return log.trim();
}

export function emptyWorkers(): Float32Array {
  return new Float32Array(MAX_WORKERS * 4);
}

export function emptyRipples(): Float32Array {
  return new Float32Array(MAX_RIPPLES * 4);
}

interface CompiledCustomUniform {
  readonly name: string;
  readonly loc: WebGLUniformLocation;
  readonly defaultValue: UniformValue;
  readonly defaultRgb: Rgb | null;
}

export class SceneRenderer {
  private readonly locations = new Map<string, WebGLUniformLocation | null>();
  private readonly colorCache = new Map<string, Rgb>();
  private readonly paletteData = new Float32Array(12);
  private readonly customUniforms: readonly CompiledCustomUniform[];
  private readonly uResolution: WebGLUniformLocation | null;
  private readonly uTime: WebGLUniformLocation | null;
  private readonly uIntensity: WebGLUniformLocation | null;
  private readonly uMotion: WebGLUniformLocation | null;
  private readonly uNeedsYou: WebGLUniformLocation | null;
  private readonly uPalette: WebGLUniformLocation | null;
  private readonly uWorkers: WebGLUniformLocation | null;
  private readonly uRipples: WebGLUniformLocation | null;
  private readonly uWorkerColor: WebGLUniformLocation | null;
  private readonly uNeedsYouColor: WebGLUniformLocation | null;
  private readonly uFinishedColor: WebGLUniformLocation | null;
  private readonly uErrorColor: WebGLUniformLocation | null;
  private readonly uClear: WebGLUniformLocation | null;
  private readonly uOpen: WebGLUniformLocation | null;
  private readonly uCards: WebGLUniformLocation | null;
  private readonly uLightSpot: WebGLUniformLocation | null;
  private readonly uLayer: WebGLUniformLocation | null;
  private lastWidth = -1;
  private lastHeight = -1;
  private disposed = false;
  private layerTexture: WebGLTexture | null = null;
  private layerVersion: number | null = null;

  private constructor(private readonly gl: WebGLRenderingContext, private readonly program: WebGLProgram, private readonly buffer: WebGLBuffer, scene: ShaderScene) {
    this.uResolution = this.location("u_resolution");
    this.uTime = this.location("u_time");
    this.uIntensity = this.location("u_intensity");
    this.uMotion = this.location("u_motion");
    this.uNeedsYou = this.location("u_needsYou");
    this.uPalette = this.location("u_palette");
    this.uWorkers = this.location("u_workers");
    this.uRipples = this.location("u_ripples");
    this.uWorkerColor = this.location("u_workerColor");
    this.uNeedsYouColor = this.location("u_needsYouColor");
    this.uFinishedColor = this.location("u_finishedColor");
    this.uErrorColor = this.location("u_errorColor");
    this.uClear = this.location("u_clear");
    this.uOpen = this.location("u_open");
    this.uCards = this.location("u_cards");
    this.uLightSpot = this.location("u_lightSpot");
    this.uLayer = this.location("u_layer");
    const compiled: CompiledCustomUniform[] = [];
    for (const [name, value] of Object.entries(scene.uniforms)) {
      const loc = this.location(name);
      if (!loc) continue;
      compiled.push({ name, loc, defaultValue: value, defaultRgb: typeof value === "string" ? this.rgb(value) : null });
    }
    this.customUniforms = compiled;
  }

  static create(gl: WebGLRenderingContext, scene: ShaderScene): CompiledScene {
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
    if (typeof vertex === "string") return { ok: false, error: vertex };
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource(scene.source));
    if (typeof fragment === "string") { gl.deleteShader(vertex); return { ok: false, error: fragment }; }
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!program || !buffer) return { ok: false, error: "No program" };
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "a_position");
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || "Shader didn't link";
      gl.deleteProgram(program);
      return { ok: false, error: log.trim() };
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    return { ok: true, renderer: new SceneRenderer(gl, program, buffer, scene) };
  }

  private location(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    return this.locations.get(name) ?? null;
  }

  private rgb(hex: string): Rgb {
    let parsed = this.colorCache.get(hex);
    if (!parsed) {
      parsed = hexToRgb(hex);
      if (this.colorCache.size < 64) this.colorCache.set(hex, parsed);
    }
    return parsed;
  }

  private setCustomEntry(entry: CompiledCustomUniform, override: UniformValue | undefined): void {
    const gl = this.gl;
    const at = entry.loc;
    const value = override ?? entry.defaultValue;
    if (typeof value === "number") gl.uniform1f(at, value);
    else if (typeof value === "string") {
      const color = override === undefined && entry.defaultRgb ? entry.defaultRgb : this.rgb(value);
      gl.uniform3f(at, color.r, color.g, color.b);
    }
    else if (value.length === 2) gl.uniform2f(at, value[0]!, value[1]!);
    else if (value.length === 3) gl.uniform3f(at, value[0]!, value[1]!, value[2]!);
    else gl.uniform4f(at, value[0]!, value[1]!, value[2]!, value[3]!);
  }

  private bindLayer(layer: SceneLayer | null): void {
    const gl = this.gl;
    const at = this.uLayer;
    if (!at) return;
    gl.activeTexture(gl.TEXTURE0);
    if (!this.layerTexture) {
      this.layerTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.layerTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    gl.bindTexture(gl.TEXTURE_2D, this.layerTexture);
    if (layer && layer.version !== this.layerVersion) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source);
      this.layerVersion = layer.version;
    }
    gl.uniform1i(at, 0);
  }

  draw(frame: SceneFrame): void {
    if (this.disposed) return;
    const gl = this.gl;
    if (frame.width !== this.lastWidth || frame.height !== this.lastHeight) {
      this.lastWidth = frame.width;
      this.lastHeight = frame.height;
      gl.viewport(0, 0, frame.width, frame.height);
    }
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (this.uResolution) gl.uniform2f(this.uResolution, frame.width, frame.height);
    if (this.uTime) gl.uniform1f(this.uTime, frame.time);
    if (this.uIntensity) gl.uniform1f(this.uIntensity, frame.intensity);
    if (this.uMotion) gl.uniform1f(this.uMotion, frame.motion);
    if (this.uNeedsYou) gl.uniform1f(this.uNeedsYou, frame.needsYou);
    if (this.uPalette) {
      const data = this.paletteData;
      for (let i = 0; i < 4; i += 1) {
        const color = frame.palette[i]!;
        data[i * 3] = color.r;
        data[i * 3 + 1] = color.g;
        data[i * 3 + 2] = color.b;
      }
      gl.uniform3fv(this.uPalette, data);
    }
    if (this.uWorkers) gl.uniform4fv(this.uWorkers, frame.workers);
    if (this.uRipples) gl.uniform4fv(this.uRipples, frame.ripples);
    if (this.uWorkerColor) gl.uniform3f(this.uWorkerColor, frame.workerColor.r, frame.workerColor.g, frame.workerColor.b);
    if (this.uNeedsYouColor) gl.uniform3f(this.uNeedsYouColor, frame.needsYouColor.r, frame.needsYouColor.g, frame.needsYouColor.b);
    if (this.uFinishedColor) gl.uniform3f(this.uFinishedColor, frame.finishedColor.r, frame.finishedColor.g, frame.finishedColor.b);
    if (this.uErrorColor) gl.uniform3f(this.uErrorColor, frame.errorColor.r, frame.errorColor.g, frame.errorColor.b);
    const column = frame.clear ?? defaultClear(frame.width, frame.height);
    if (this.uClear) gl.uniform4f(this.uClear, column[0], column[1], column[2], column[3]);
    if (this.uOpen) { const [x0, y0, x1, y1] = frame.open ?? defaultOpen(column, frame.width, frame.height); gl.uniform4f(this.uOpen, x0, y0, x1, y1); }
    if (this.uCards) gl.uniform4fv(this.uCards, frame.cards ?? defaultCards(column, frame.width));
    if (this.uLightSpot) { const [lx, ly, ls, on] = frame.light ?? [0, 0, 1, 0]; gl.uniform4f(this.uLightSpot, lx, ly, ls, on); }
    const liveUniforms = frame.uniforms;
    for (let i = 0; i < this.customUniforms.length; i += 1) {
      const entry = this.customUniforms[i]!;
      this.setCustomEntry(entry, liveUniforms?.[entry.name]);
    }
    this.bindLayer(frame.layer ?? null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.layerTexture) this.gl.deleteTexture(this.layerTexture);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}
