import { z } from "zod";
import { placeSchema } from "../forest/sky";
import { SKY_VIEWS } from "./projection";

export const skyViewSchema = z.enum(SKY_VIEWS);
export const tonightSettingsSchema = z.object({ place: placeSchema.nullable(), previewAt: z.number().nullable(), view: skyViewSchema });
export type TonightSettings = z.infer<typeof tonightSettingsSchema>;
