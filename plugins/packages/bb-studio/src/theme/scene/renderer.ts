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

export class SceneRenderer {
  private readonly locations = new Map<string, WebGLUniformLocation | null>();
  private disposed = false;
  private layerTexture: WebGLTexture | null = null;
  private layerVersion: number | null = null;

  private constructor(private readonly gl: WebGLRenderingContext, private readonly program: WebGLProgram, private readonly buffer: WebGLBuffer, private readonly scene: ShaderScene) {}

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

  private setCustom(name: string, value: UniformValue): void {
    const gl = this.gl;
    const at = this.location(name);
    if (!at) return;
    if (typeof value === "number") gl.uniform1f(at, value);
    else if (typeof value === "string") { const color = hexToRgb(value); gl.uniform3f(at, color.r, color.g, color.b); }
    else if (value.length === 2) gl.uniform2f(at, value[0]!, value[1]!);
    else if (value.length === 3) gl.uniform3f(at, value[0]!, value[1]!, value[2]!);
    else gl.uniform4f(at, value[0]!, value[1]!, value[2]!, value[3]!);
  }

  private setColor(name: string, color: Rgb): void {
    const at = this.location(name);
    if (at) this.gl.uniform3f(at, color.r, color.g, color.b);
  }

  private bindLayer(layer: SceneLayer | null): void {
    const gl = this.gl;
    const at = this.location("u_layer");
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
    gl.viewport(0, 0, frame.width, frame.height);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const set1 = (name: string, value: number) => { const at = this.location(name); if (at) gl.uniform1f(at, value); };
    const resolution = this.location("u_resolution");
    if (resolution) gl.uniform2f(resolution, frame.width, frame.height);
    set1("u_time", frame.time);
    set1("u_intensity", frame.intensity);
    set1("u_motion", frame.motion);
    set1("u_needsYou", frame.needsYou);
    const palette = this.location("u_palette");
    if (palette) gl.uniform3fv(palette, frame.palette.flatMap((color) => [color.r, color.g, color.b]));
    const workers = this.location("u_workers");
    if (workers) gl.uniform4fv(workers, frame.workers);
    const ripples = this.location("u_ripples");
    if (ripples) gl.uniform4fv(ripples, frame.ripples);
    this.setColor("u_workerColor", frame.workerColor);
    this.setColor("u_needsYouColor", frame.needsYouColor);
    this.setColor("u_finishedColor", frame.finishedColor);
    this.setColor("u_errorColor", frame.errorColor);
    const column = frame.clear ?? defaultClear(frame.width, frame.height);
    const clear = this.location("u_clear");
    if (clear) gl.uniform4f(clear, column[0], column[1], column[2], column[3]);
    const open = this.location("u_open");
    if (open) { const [x0, y0, x1, y1] = frame.open ?? defaultOpen(column, frame.width, frame.height); gl.uniform4f(open, x0, y0, x1, y1); }
    const cards = this.location("u_cards");
    if (cards) gl.uniform4fv(cards, frame.cards ?? defaultCards(column, frame.width));
    for (const [name, value] of Object.entries(this.scene.uniforms)) this.setCustom(name, frame.uniforms?.[name] ?? value);
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
