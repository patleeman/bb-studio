import type { ClearRect } from "./contract";

export const FOCAL_INSET = 0.014;
export const FOCAL_MARGIN = 0.02;

export function glslFloat(value: number): string {
  const text = String(Math.round(value * 10000) / 10000);
  return text.includes(".") ? text : `${text}.0`;
}

export function focalSpan(open: ClearRect, width: number, height: number): { left: number; right: number } {
  const edge = 2.2 * FOCAL_INSET * height, margin = FOCAL_MARGIN * height;
  const left = open[0] + (open[0] > 0.5 ? edge : margin);
  const right = open[2] - (open[2] < width - 0.5 ? edge : margin);
  return { left, right: Math.max(left, right) };
}

export const FOCAL_FADE = `openFade(gl_FragCoord.xy, ${glslFloat(FOCAL_INSET)} * u_resolution.y)`;

export const FOCAL_GLSL = `vec2 focalSpan() {
  float edge = ${glslFloat(2.2 * FOCAL_INSET)} * u_resolution.y;
  float margin = ${glslFloat(FOCAL_MARGIN)} * u_resolution.y;
  float lo = u_open.x + (u_open.x > 0.5 ? edge : margin);
  float hi = u_open.z - (u_open.z < u_resolution.x - 0.5 ? edge : margin);
  return vec2(lo, max(hi, lo));
}
`;
