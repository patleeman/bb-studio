import { AMBER_LIGHT, type Palette, type PresenceStateName } from "./forms";
import { tripleToHex } from "./palette";

export interface HaloInput {
  surfaceLight: boolean;
  state: PresenceStateName;
  size: number;
  clock: number;
  palette: Palette;
}

export const HALO_EDGE: Record<PresenceStateName, number> = { idle: 0.32, thinking: 0.24, working: 0.6, needs: 0.4 };
export const HALO_GLOW: Record<PresenceStateName, number> = { idle: 0, thinking: 0.7, working: 0.3, needs: 0.85 };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const percent = (share: number) => Math.round(clamp(share, 0, 1) * 100);
const px = (value: number) => Number(value.toFixed(2));
const ink = (share: number) => `color-mix(in oklab, var(--ink) ${percent(share)}%, transparent)`;

export function haloPulse(state: PresenceStateName, clock: number): number {
  if (state === "thinking") return 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(clock * 5.2));
  if (state === "needs") return 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(clock * 3.4), 2);
  return 1;
}

export function haloFilter({ surfaceLight, state, size, clock, palette }: HaloInput): string {
  if (!surfaceLight) return "none";
  const edge = px(clamp(size / 48, 0.5, 1.25));
  const parts = [`drop-shadow(0 0 ${edge}px ${ink(HALO_EDGE[state])})`];
  if (state === "working") parts.push(`drop-shadow(0 0 ${px(edge * 0.5)}px ${ink(HALO_EDGE.working * 0.6)})`);
  const glow = HALO_GLOW[state] * haloPulse(state, clock);
  if (glow > 0.02) {
    const tint = tripleToHex(state === "needs" ? AMBER_LIGHT[0] : palette[0]);
    parts.push(`drop-shadow(0 0 ${px(clamp(size / 9, 2, 7))}px color-mix(in oklab, ${tint} ${percent(glow)}%, transparent))`);
  }
  return parts.join(" ");
}

const applied = new WeakMap<HTMLElement, string>();

export function applyHalo(element: HTMLElement, filter: string): void {
  if (applied.get(element) === filter) return;
  applied.set(element, filter);
  element.style.filter = filter === "none" ? "" : filter;
}
