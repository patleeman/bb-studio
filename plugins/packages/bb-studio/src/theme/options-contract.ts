import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { themeOptions, type ThemeOptionValues } from "./options";
import { readView, writeView, type PreviewKv } from "./tonight/contract";
import { skyViewSchema } from "./tonight/settings";

const valuesSchema = z.object({ values: z.record(z.string(), z.string()) });

export const themeOptionsContract = defineRpcContract({
  "theme.options": {
    experimental_description: "A theme's options and their current values, by option id. Tonight's Sky (tonights-sky) has view: follow, south, east or west. A theme with no options returns no values.",
    input: z.object({ themeId: z.string().min(1).max(80) }).strict(),
    output: valuesSchema,
  },
  "theme.options.set": {
    experimental_description: "Sets one of a theme's options to one of its choices and returns the theme's values. The window follows at once where it was set and within 15 seconds elsewhere.",
    input: z.object({ themeId: z.string().min(1).max(80), id: z.string().min(1).max(40), value: z.string().min(1).max(80) }).strict(),
    output: valuesSchema,
  },
});

export interface OptionStore { read(): Promise<string>; write(value: string): Promise<void> }
export type OptionStores = Readonly<Record<string, Readonly<Record<string, OptionStore>>>>;

export function builtinOptionStores(kv: PreviewKv): OptionStores {
  return { "tonights-sky": { view: { read: () => readView(kv), write: (value) => writeView(kv, skyViewSchema.parse(value)) } } };
}

export async function readThemeOptions(stores: OptionStores, themeId: string): Promise<{ values: ThemeOptionValues }> {
  const values: Record<string, string> = {};
  for (const option of themeOptions(themeId)) {
    const store = stores[themeId]?.[option.id];
    values[option.id] = store ? await store.read() : option.fallback;
  }
  return { values };
}

export async function writeThemeOption(stores: OptionStores, themeId: string, id: string, value: string): Promise<{ values: ThemeOptionValues }> {
  const option = themeOptions(themeId).find((each) => each.id === id);
  const store = stores[themeId]?.[id];
  if (!option || !store) throw new Error(`No option ${id} on theme ${themeId}`);
  if (!option.choices.some((choice) => choice.value === value)) throw new Error(`${option.label} is one of: ${option.choices.map((choice) => choice.value).join(", ")}`);
  await store.write(value);
  return readThemeOptions(stores, themeId);
}
