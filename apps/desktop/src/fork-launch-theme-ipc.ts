export const FORK_LAUNCH_THEME_GET_CHANNEL = "bb-desktop:fork-launch-theme:get";
export const FORK_LAUNCH_THEME_SET_CHANNEL = "bb-desktop:fork-launch-theme:set";
export const FORK_LAUNCH_THEME_FILE = "fork-launch-theme.json";

const MAX_PROPERTIES = 600;
const MAX_ATTRIBUTES = 16;
const MAX_VALUE_LENGTH = 2000;
const PROPERTY_NAME = /^(--[A-Za-z0-9_-]+|color-scheme)$/u;
const ATTRIBUTE_NAME = /^data-fork-[a-z-]+$/u;
const HEX_COLOR = /^#[0-9a-f]{6}$/u;

export interface LaunchAppearance {
  version: 1;
  mode: "light" | "dark" | null;
  background: string;
  properties: [string, string][];
  attributes: [string, string][];
}

function pairs(
  value: unknown,
  name: RegExp,
  max: number,
): [string, string][] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: [string, string][] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [key, text] = entry as unknown[];
    if (typeof key !== "string" || !name.test(key)) return null;
    if (typeof text !== "string" || text.length > MAX_VALUE_LENGTH) return null;
    out.push([key, text]);
  }
  return out;
}

export function parseLaunchAppearance(value: unknown): LaunchAppearance | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  const mode =
    record.mode === "light" || record.mode === "dark" ? record.mode : null;
  if (record.mode !== null && mode === null) return null;
  if (typeof record.background !== "string" || !HEX_COLOR.test(record.background)) {
    return null;
  }
  const properties = pairs(record.properties, PROPERTY_NAME, MAX_PROPERTIES);
  const attributes = pairs(record.attributes, ATTRIBUTE_NAME, MAX_ATTRIBUTES);
  if (properties === null || attributes === null) return null;
  return { version: 1, mode, background: record.background, properties, attributes };
}
