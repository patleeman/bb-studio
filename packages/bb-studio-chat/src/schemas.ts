import { z } from "zod";

export const ref = z.object({ pluginId: z.string().min(1).max(100), id: z.string().min(1).max(200) });
export const quote = z.object({
  text: z.string().max(20_000).nullable(),
  note: z.string().max(10_000),
  where: z.string().max(300).nullable(),
  image: z.string().max(4_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/).nullable(),
}).refine(value => value.text?.trim() || value.image || value.note.trim(), "Select something or write a note.");

export type ItemRef = z.infer<typeof ref>;
