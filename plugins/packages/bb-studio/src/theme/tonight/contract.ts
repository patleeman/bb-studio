import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DEFAULT_VIEW, type SkyView } from "./projection";
import { skyViewSchema, tonightSettingsSchema } from "./settings";

export const PREVIEW_KEY = "theme.sky.preview";
export const VIEW_KEY = "theme.sky.view";

export const tonightContract = defineRpcContract({
  "theme.sky": {
    experimental_description: "Tonight's Sky theme's place (Forest's city, else the time zone's place), its preview time in epoch milliseconds, or null when it follows the clock, and its view: follow (the Sun by day; the Moon or the brightest planet by night), south, east or west. timeZone: the computer's IANA time zone.",
    input: z.object({ timeZone: z.string().max(80).nullable() }).strict(),
    output: tonightSettingsSchema,
  },
});

export interface PreviewKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export async function readPreview(kv: PreviewKv): Promise<number | null> {
  const stored = await kv.get<{ at?: unknown }>(PREVIEW_KEY).catch(() => undefined);
  return stored && typeof stored.at === "number" && Number.isFinite(stored.at) ? stored.at : null;
}

export async function writePreview(kv: PreviewKv, at: number | null): Promise<void> {
  if (at === null) await kv.delete(PREVIEW_KEY);
  else await kv.set(PREVIEW_KEY, { at });
}

export async function readView(kv: PreviewKv): Promise<SkyView> {
  const stored = await kv.get<{ view?: unknown }>(VIEW_KEY).catch(() => undefined);
  const parsed = skyViewSchema.safeParse(stored?.view);
  return parsed.success ? parsed.data : DEFAULT_VIEW;
}

export async function writeView(kv: PreviewKv, view: SkyView): Promise<void> {
  if (view === DEFAULT_VIEW) await kv.delete(VIEW_KEY);
  else await kv.set(VIEW_KEY, { view });
}
