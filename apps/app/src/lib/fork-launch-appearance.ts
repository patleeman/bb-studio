import type { BbDesktopApi } from "@bb/desktop-contract";

export type ForkLaunchAppearance = NonNullable<
  BbDesktopApi["experimental_launchAppearance"]
>;

type LaunchBridge = Pick<
  BbDesktopApi,
  "experimental_launchAppearance" | "experimental_saveLaunchAppearance"
>;

function bridge(): LaunchBridge | null {
  if (typeof window === "undefined") return null;
  return (window as { bbDesktop?: LaunchBridge }).bbDesktop ?? null;
}

const LAUNCH_THEME_STYLE_ID = "fork-launch-theme";

let pending: ForkLaunchAppearance | null =
  bridge()?.experimental_launchAppearance ?? null;
let lastSaved: string | null = null;

export function hasLaunchAppearance(): boolean {
  return pending !== null;
}

export function launchAppearanceMode(): "light" | "dark" | null {
  return pending?.mode ?? null;
}

export function clearLaunchAppearance(
  root: HTMLElement = document.documentElement,
): void {
  if (pending === null) return;
  for (const [name] of pending.properties) root.style.removeProperty(name);
  for (const [name] of pending.attributes) root.removeAttribute(name);
  root.style.removeProperty("background-color");
  root.ownerDocument.getElementById(LAUNCH_THEME_STYLE_ID)?.remove();
  if (pending.mode !== null) root.style.removeProperty("color-scheme");
  pending = null;
}

export function resetLaunchAppearanceForTest(
  value: ForkLaunchAppearance | null,
): void {
  pending = value;
  lastSaved = null;
}

function toHex(channels: Uint8ClampedArray): string {
  return `#${[channels[0], channels[1], channels[2]]
    .map((channel) => (channel ?? 0).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function resolvedBackground(
  root: HTMLElement,
  mode: "light" | "dark" | null,
): string {
  const fallback =
    (mode ?? (root.classList.contains("dark") ? "dark" : "light")) === "dark"
      ? "#151515"
      : "#ffffff";
  const doc = root.ownerDocument;
  const probe = doc.createElement("div");
  probe.style.cssText =
    "position:fixed;width:1px;height:1px;pointer-events:none;visibility:hidden;background-color:var(--background)";
  root.appendChild(probe);
  try {
    const color = doc.defaultView?.getComputedStyle(probe).backgroundColor;
    const canvas = doc.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!color || !context) return fallback;
    context.fillStyle = fallback;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return pixel[3] === 0 ? fallback : toHex(pixel);
  } catch {
    return fallback;
  } finally {
    probe.remove();
  }
}

export function snapshotLaunchAppearance(
  root: HTMLElement,
  mode: "light" | "dark" | null,
  properties: ReadonlyMap<string, string>,
  attributes: readonly string[],
): ForkLaunchAppearance {
  return {
    version: 1,
    mode,
    background: resolvedBackground(root, mode),
    properties: [...properties],
    attributes: attributes.flatMap((name): [string, string][] => {
      const value = root.getAttribute(name);
      return value === null ? [] : [[name, value]];
    }),
  };
}

export function saveLaunchAppearance(
  value: ForkLaunchAppearance | null,
): void {
  const save = bridge()?.experimental_saveLaunchAppearance;
  if (!save) return;
  const json = JSON.stringify(value);
  if (json === lastSaved) return;
  lastSaved = json;
  save(value);
}
