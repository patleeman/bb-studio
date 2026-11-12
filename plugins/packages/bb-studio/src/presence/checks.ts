import { PRESENCE_STATES, type PresenceStateName } from "./forms";
import { isBuiltinPresence, MAX_CODE, presencePackageSchema, type PresencePackage } from "./schema";

export interface CheckLine { id: string; pass: boolean; reason: string }
export interface CheckReport { pass: boolean; results: CheckLine[]; presence: PresencePackage | null }

export const CHECK_SIZES = [24, 36, 160] as const;
export const MEASURED_CHECKS = ["runs", "render:24", "render:36", "render:160", "frame-time", "states", "light", "states:24", "motion", "still"] as const;
export const LIGHT_CHECK_SIZE = 24;
export const FRAME_BUDGET_MS = 6;
export const SLOWEST_FRAME_MS = 60;
export const MIN_COVERAGE = 0.02;
export const MIN_STATE_DIFFERENCE = 0.008;
export const MIN_LIGHT_VISIBLE = 0.02;
export const LIGHT_STANDOUT = 0.2;
export const MIN_SMALL_STATE_DIFFERENCE = 0.02;
export const MIN_MOTION_DIFFERENCE = 0.002;
export const MAX_STILL_DIFFERENCE = 0.0005;

export const NETWORK_NAMES = ["fetch", "XMLHttpRequest", "WebSocket", "WebSocketStream", "WebTransport", "EventSource", "importScripts", "sendBeacon", "Worker", "SharedWorker", "ServiceWorker", "serviceWorker", "RTCPeerConnection", "BroadcastChannel", "navigator", "Request", "FontFace", "http://", "https://", "ws://", "wss://"] as const;
export const ISOLATION_NAMES = ["window", "document", "parent", "opener", "frames", "self", "globalThis", "postMessage", "onmessage", "addEventListener", "eval", "Function", "constructor", "__proto__", "prototype", "setTimeout", "setInterval", "requestAnimationFrame", "queueMicrotask", "indexedDB", "localStorage", "sessionStorage", "caches", "cookie", "location", "require", "process", "WebAssembly", "Atomics", "SharedArrayBuffer", "__presenceStart"] as const;

function stripped(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\'"`])\/\/[^\n]*/g, "$1 ");
}

function found(code: string, names: readonly string[]): string[] {
  return names.filter((name) => (/^[\w$]+$/.test(name) ? new RegExp(`(^|[^\\w$])${name.replace(/\$/g, "\\$")}([^\\w$]|$)`).test(code) : code.includes(name)));
}

export function usesImport(code: string): boolean {
  return /(^|[^\w$.])(import|export)(?![\w$])/.test(code);
}

export function staticChecks(input: unknown): CheckReport {
  const parsed = presencePackageSchema.safeParse(input);
  if (!parsed.success) {
    const reason = parsed.error.issues.map((issue) => `${issue.path.join(".") || "presence"}: ${issue.message}`).join("; ");
    return { pass: false, presence: null, results: [{ id: "schema", pass: false, reason }] };
  }
  const presence = parsed.data, results: CheckLine[] = [{ id: "schema", pass: true, reason: `${presence.id}: id, name, description and code` }];
  if (isBuiltinPresence(presence.id)) results.push({ id: "id", pass: false, reason: `${presence.id} is a built-in form` });
  results.push({ id: "size", pass: presence.code.length <= MAX_CODE, reason: `${presence.code.length} characters (most ${MAX_CODE})` });
  const code = stripped(presence.code);
  const declared = /(^|[^\w$.])function\s+draw\s*\(/.test(code);
  results.push({ id: "api", pass: declared, reason: declared ? "Declares function draw(ctx, t, state, palette, size)" : "The module must declare function draw(ctx, t, state, palette, size) at the top level" });
  const network = [...found(code, NETWORK_NAMES), ...(usesImport(code) ? ["import/export"] : [])];
  results.push({ id: "network", pass: !network.length, reason: network.length ? `Refers to ${network.join(", ")}. A presence has no network.` : "No network API referenced" });
  const isolation = found(code, ISOLATION_NAMES);
  results.push({ id: "isolation", pass: !isolation.length, reason: isolation.length ? `Refers to ${isolation.join(", ")}. A presence draws on its ctx and nothing else.` : "No DOM, window, timer or dynamic code referenced" });
  return { pass: results.every((line) => line.pass), presence, results };
}

export interface RenderSample { size: number; state: PresenceStateName; t: number; width: number; height: number; pixels: Uint8ClampedArray }
export interface Measurement { failure: string | null; samples: readonly RenderSample[]; light: readonly RenderSample[]; repeat: RenderSample | null; later: RenderSample | null; frameMs: readonly number[] }

export function coverage(sample: Pick<RenderSample, "pixels">): number {
  const data = sample.pixels;
  let lit = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 24) lit++;
  return data.length ? lit / (data.length / 4) : 0;
}

export function standout(sample: Pick<RenderSample, "pixels">): number {
  const data = sample.pixels;
  let seen = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]! / 255;
    const away = Math.max(255 - data[i]!, 255 - data[i + 1]!, 255 - data[i + 2]!) * alpha / 255;
    if (away >= LIGHT_STANDOUT) seen++;
  }
  return data.length ? seen / (data.length / 4) : 0;
}

export function difference(a: Pick<RenderSample, "pixels">, b: Pick<RenderSample, "pixels">): number {
  if (a.pixels.length !== b.pixels.length || !a.pixels.length) return 1;
  let total = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    const aa = a.pixels[i + 3]! / 255, ba = b.pixels[i + 3]! / 255;
    total += Math.max(Math.abs(a.pixels[i]! * aa - b.pixels[i]! * ba), Math.abs(a.pixels[i + 1]! * aa - b.pixels[i + 1]! * ba), Math.abs(a.pixels[i + 2]! * aa - b.pixels[i + 2]! * ba), Math.abs(a.pixels[i + 3]! - b.pixels[i + 3]!)) / 255;
  }
  return total / (a.pixels.length / 4);
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : Infinity;
}

export function evaluateMeasurement(measurement: Measurement): CheckLine[] {
  if (measurement.failure) return [{ id: "runs", pass: false, reason: measurement.failure }];
  const results: CheckLine[] = [{ id: "runs", pass: true, reason: "Starts and draws in the sandbox" }];
  for (const size of CHECK_SIZES) {
    const own = measurement.samples.filter((sample) => sample.size === size);
    const low = own.reduce<{ state: string; value: number } | null>((least, sample) => { const value = coverage(sample); return !least || value < least.value ? { state: sample.state, value } : least; }, null);
    const all = own.length === PRESENCE_STATES.length;
    results.push({
      id: `render:${size}`,
      pass: all && !!low && low.value >= MIN_COVERAGE,
      reason: !all || !low ? `Not every state drew at ${size} px` : `${size} px: at least ${percent(low.value)} of pixels drawn (${low.state}; min ${percent(MIN_COVERAGE)})`,
    });
  }
  const mid = median(measurement.frameMs), slow = Math.max(0, ...measurement.frameMs);
  results.push({
    id: "frame-time",
    pass: measurement.frameMs.length > 0 && mid <= FRAME_BUDGET_MS && slow <= SLOWEST_FRAME_MS,
    reason: measurement.frameMs.length ? `Median ${mid.toFixed(1)} ms, slowest ${slow.toFixed(1)} ms at 160 px (budget ${FRAME_BUDGET_MS} ms, slowest ${SLOWEST_FRAME_MS} ms)` : "No frames were timed",
  });
  const close: string[] = [];
  let least = Infinity;
  for (const size of [36, 160]) {
    const own = measurement.samples.filter((sample) => sample.size === size);
    for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) {
      const value = difference(own[i]!, own[j]!);
      least = Math.min(least, value);
      if (value < MIN_STATE_DIFFERENCE) close.push(`${own[i]!.state}/${own[j]!.state} at ${size} px (${percent(value)})`);
    }
  }
  results.push({
    id: "states",
    pass: Number.isFinite(least) && !close.length,
    reason: close.length ? `These states look the same: ${close.join(", ")}. Each pair must differ by ${percent(MIN_STATE_DIFFERENCE)} of the picture.` : `Idle, thinking, working and needs you all differ at 36 and 160 px (least ${percent(least)})`,
  });
  const lightAll = measurement.light.length === PRESENCE_STATES.length;
  const faint = measurement.light.reduce<{ state: string; value: number } | null>((least, sample) => { const value = standout(sample); return !least || value < least.value ? { state: sample.state, value } : least; }, null);
  results.push({
    id: "light",
    pass: lightAll && !!faint && faint.value >= MIN_LIGHT_VISIBLE,
    reason: !lightAll || !faint ? `Not every state drew at ${LIGHT_CHECK_SIZE} px in the light palette` : `${LIGHT_CHECK_SIZE} px on a white ground in the light palette: at least ${percent(faint.value)} of pixels stand out (${faint.state}; min ${percent(MIN_LIGHT_VISIBLE)})`,
  });
  const alike: string[] = [];
  let nearest = Infinity;
  for (let i = 0; i < measurement.light.length; i++) for (let j = i + 1; j < measurement.light.length; j++) {
    const value = difference(measurement.light[i]!, measurement.light[j]!);
    nearest = Math.min(nearest, value);
    if (value < MIN_SMALL_STATE_DIFFERENCE) alike.push(`${measurement.light[i]!.state}/${measurement.light[j]!.state} (${percent(value)})`);
  }
  results.push({
    id: "states:24",
    pass: lightAll && Number.isFinite(nearest) && !alike.length,
    reason: alike.length ? `These states look the same at ${LIGHT_CHECK_SIZE} px in the light palette: ${alike.join(", ")}. Each pair must differ by ${percent(MIN_SMALL_STATE_DIFFERENCE)} of the picture.` : `All four states differ at ${LIGHT_CHECK_SIZE} px in the light palette (least ${Number.isFinite(nearest) ? percent(nearest) : "none"})`,
  });
  const first = measurement.samples.find((sample) => sample.size === 160 && sample.state === "idle") ?? null;
  const moved = first && measurement.later ? difference(first, measurement.later) : 0;
  results.push({ id: "motion", pass: moved >= MIN_MOTION_DIFFERENCE, reason: `Idle changes ${percent(moved)} of the picture over 1.5 s (min ${percent(MIN_MOTION_DIFFERENCE)})` });
  const same = first && measurement.repeat ? difference(first, measurement.repeat) : 1;
  results.push({ id: "still", pass: same <= MAX_STILL_DIFFERENCE, reason: same <= MAX_STILL_DIFFERENCE ? "The same time draws the same frame, so reduced motion shows a still" : `Two draws at the same time differ by ${percent(same)}. Draw from t only, with no random or stored state.` });
  return results;
}

export const NOT_MEASURED: CheckLine = { id: "runs", pass: false, reason: "No BB Studio window answered to run the presence in its sandbox. Open BB Studio and try again." };

export function fullReport(first: CheckReport, measured: readonly CheckLine[] | null): CheckReport {
  if (!first.pass || !first.presence) return first;
  const results = [...first.results, ...(measured?.length ? measured : [NOT_MEASURED])];
  return { pass: results.every((line) => line.pass), presence: first.presence, results };
}

export function formatReport(report: CheckReport): string {
  const lines = report.results.map((line) => `${line.pass ? "pass" : "FAIL"}  ${line.id}  ${line.reason}`);
  return [`Checks ${report.pass ? "passed" : "failed"}${report.presence ? ` for ${report.presence.id}` : ""}:`, ...lines].join("\n");
}
