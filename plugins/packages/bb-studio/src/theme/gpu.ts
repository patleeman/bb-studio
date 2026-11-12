import { z } from "zod";
import { checkTheme, MEASURED_CHECKS, type CheckLine, type CheckOptions } from "./checks";
import { themePackageSchema, type ThemePackage } from "./schema";

export const THEME_GPU_CHANNEL = "studio-theme-gpu";
export const GPU_CLAIM_MS = 1500;
export const GPU_RESULT_MS = 15_000;

export const gpuRequestSchema = z.object({ requestId: z.string().min(1).max(100), theme: themePackageSchema });
export type GpuRequest = z.infer<typeof gpuRequestSchema>;

export function measuredLines(theme: ThemePackage, options: CheckOptions): CheckLine[] {
  const ids: readonly string[] = MEASURED_CHECKS;
  return checkTheme(theme, options).results.filter((line) => ids.includes(line.id) && !line.reason.startsWith("Static estimate") && !line.reason.startsWith("Declared "));
}

export function browserCheckContext(doc: Document): { createContext: CheckOptions["createContext"]; release(): void } {
  const made: WebGLRenderingContext[] = [];
  return {
    createContext: (width, height) => {
      if (typeof doc.defaultView?.WebGLRenderingContext !== "function") return null;
      const canvas = doc.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      let gl: WebGLRenderingContext | null = null;
      try { gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true }) as WebGLRenderingContext | null; } catch { gl = null; }
      if (gl) made.push(gl);
      return gl;
    },
    release: () => {
      for (const gl of made.splice(0)) gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

export interface GpuBridgeDeps {
  canMeasure(): boolean;
  claim(requestId: string): Promise<boolean>;
  reply(requestId: string, results: CheckLine[]): Promise<unknown>;
  measure(theme: ThemePackage): CheckLine[];
}

export async function handleGpuRequest(payload: unknown, deps: GpuBridgeDeps): Promise<boolean> {
  const parsed = gpuRequestSchema.safeParse(payload);
  if (!parsed.success || !deps.canMeasure()) return false;
  if (!(await deps.claim(parsed.data.requestId).catch(() => false))) return false;
  let results: CheckLine[] = [];
  try { results = deps.measure(parsed.data.theme); } catch { results = []; }
  await deps.reply(parsed.data.requestId, results).catch(() => {});
  return true;
}
