export const PIN_MENTION_PROVIDER = "desktop-pins";
const ID_PREFIX = "p1.";
const MAX_ID = 1800;

export interface PinFacts {
  number: number;
  app: string | null;
  bundleId: string | null;
  windowTitle: string | null;
  url: string | null;
  role: string | null;
  label: string | null;
  pid: number | null;
  windowId: number | null;
  x: number;
  y: number;
  windowX: number | null;
  windowY: number | null;
  secure: boolean;
  image: boolean;
}

export interface PinLike {
  number: number;
  app: string | null;
  bundleId: string | null;
  windowTitle: string | null;
  windowBounds: { x: number; y: number } | null;
  url: string | null;
  role: string | null;
  label: string | null;
  pid: number | null;
  windowId: number | null;
  x: number;
  y: number;
  secure: boolean;
  imagePath: string | null;
}

export function pinFacts(pin: PinLike): PinFacts {
  return {
    number: pin.number,
    app: pin.app,
    bundleId: pin.bundleId,
    windowTitle: pin.windowTitle,
    url: pin.url,
    role: pin.role,
    label: pin.secure ? null : pin.label,
    pid: pin.pid,
    windowId: pin.windowId,
    x: Math.round(pin.x),
    y: Math.round(pin.y),
    windowX: pin.windowBounds === null ? null : Math.round(pin.x - pin.windowBounds.x),
    windowY: pin.windowBounds === null ? null : Math.round(pin.y - pin.windowBounds.y),
    secure: pin.secure,
    image: pin.imagePath !== null,
  };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function clip(value: string | null, max: number): string | null {
  return value === null ? null : value.slice(0, max);
}

export function encodePinMention(facts: PinFacts): string {
  let compact: PinFacts = facts;
  let id = ID_PREFIX + toBase64Url(JSON.stringify(compact));
  if (id.length > MAX_ID) {
    compact = { ...facts, url: clip(facts.url, 300), windowTitle: clip(facts.windowTitle, 80), label: clip(facts.label, 80) };
    id = ID_PREFIX + toBase64Url(JSON.stringify(compact));
  }
  return id;
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function decodePinMention(id: string): PinFacts | null {
  if (!id.startsWith(ID_PREFIX)) return null;
  try {
    const raw = JSON.parse(fromBase64Url(id.slice(ID_PREFIX.length))) as Record<string, unknown>;
    const number = num(raw.number);
    const x = num(raw.x);
    const y = num(raw.y);
    if (number === null || x === null || y === null) return null;
    return {
      number,
      app: str(raw.app, 120),
      bundleId: str(raw.bundleId, 200),
      windowTitle: str(raw.windowTitle, 300),
      url: str(raw.url, 2000),
      role: str(raw.role, 80),
      label: str(raw.label, 300),
      pid: num(raw.pid),
      windowId: num(raw.windowId),
      x,
      y,
      windowX: num(raw.windowX),
      windowY: num(raw.windowY),
      secure: raw.secure === true,
      image: raw.image === true,
    };
  } catch {
    return null;
  }
}

export function shortUrl(url: string | null, max = 40): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return parsed.pathname.split("/").pop()?.slice(0, max) || null;
    const short = `${parsed.host.replace(/^www\./u, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    return short.length > max ? `${short.slice(0, max - 1)}…` : short;
  } catch {
    return url.slice(0, max);
  }
}

export function pinChipLabel(pin: Pick<PinFacts, "number" | "app" | "label" | "role" | "url" | "windowTitle">): string {
  const element = pin.label !== null ? `“${pin.label.length > 32 ? `${pin.label.slice(0, 31)}…` : pin.label}”` : pin.role;
  const where = shortUrl(pin.url) ?? (pin.label === null ? pin.windowTitle : null);
  const parts = [String(pin.number), pin.app, element, where].filter((part): part is string => part !== null && part.length > 0);
  return parts.length > 1 ? parts.join(" · ") : `${String(pin.number)} · Screen`;
}

export function pinMentionContext(pin: PinFacts): string {
  const lines = [`The user pointed at this (pin ${String(pin.number)} on their screen):`];
  if (pin.app !== null) lines.push(`App: ${pin.app}${pin.bundleId === null ? "" : ` (${pin.bundleId})`}`);
  if (pin.windowTitle !== null) lines.push(`Window: ${pin.windowTitle}`);
  if (pin.url !== null) lines.push(`URL: ${pin.url}`);
  if (pin.secure) lines.push("Element: a password field. Off-limits: never read, click or type into it.");
  else if (pin.role !== null || pin.label !== null) lines.push(`Element: ${[pin.role, pin.label === null ? null : `“${pin.label}”`].filter(Boolean).join(" ")}`);
  if (pin.pid !== null && pin.windowId !== null) lines.push(`desktop tools: pid ${String(pin.pid)}, window_id ${String(pin.windowId)}`);
  if (pin.windowX !== null && pin.windowY !== null) lines.push(`Point in the window: ${String(pin.windowX)}, ${String(pin.windowY)} (points from its top-left)`);
  lines.push(`Point on screen: ${String(pin.x)}, ${String(pin.y)}`);
  if (pin.image) lines.push("A screenshot of the window is attached to this message.");
  return lines.join("\n");
}
