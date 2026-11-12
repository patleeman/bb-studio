import { DEFAULT_VIEW, SKY_VIEWS, VIEW_NAMES } from "./tonight/projection";

export interface ThemeOption {
  id: string;
  label: string;
  choices: readonly { value: string; label: string }[];
  fallback: string;
}

export type ThemeOptionValues = Readonly<Record<string, string>>;

export const THEME_OPTIONS: Readonly<Record<string, readonly ThemeOption[]>> = {
  "tonights-sky": [{ id: "view", label: "View", choices: SKY_VIEWS.map((value) => ({ value, label: VIEW_NAMES[value] })), fallback: DEFAULT_VIEW }],
};

export function themeOptions(themeId: string | null | undefined): readonly ThemeOption[] {
  return (themeId && Object.hasOwn(THEME_OPTIONS, themeId) ? THEME_OPTIONS[themeId] : undefined) ?? [];
}

export function optionValue(option: ThemeOption, values: ThemeOptionValues | null): string {
  const stored = values?.[option.id];
  return stored !== undefined && option.choices.some((choice) => choice.value === stored) ? stored : option.fallback;
}

const listeners = new Set<(themeId: string) => void>();

export function onThemeOptions(run: (themeId: string) => void): () => void {
  listeners.add(run);
  return () => { listeners.delete(run); };
}

export function themeOptionsChanged(themeId: string): void {
  for (const run of [...listeners]) run(themeId);
}

export interface ThemeOptionsClient {
  load(themeId: string): Promise<ThemeOptionValues>;
  save(themeId: string, id: string, value: string): Promise<ThemeOptionValues>;
}

async function callOptions(method: string, input: object): Promise<ThemeOptionValues> {
  const response = await fetch(`/api/v1/plugins/studio/rpc/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json() as { ok?: boolean; result?: { values?: unknown } };
  const values = body.ok ? body.result?.values : null;
  if (!values || typeof values !== "object") throw new Error("No theme options");
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export const optionsOverRpc: ThemeOptionsClient = {
  load: (themeId) => callOptions("theme.options", { themeId }),
  save: (themeId, id, value) => callOptions("theme.options.set", { themeId, id, value }),
};
