import { errorMessage } from "../kit/format";
import { z } from "zod";

// Agents write charts and stat rows as fenced JSON in markdown
// (```chart / ```stats). These schemas are the contract for that JSON, and
// the editor parses the stored props with the same schemas.

const cell = z.union([z.string().max(200), z.number(), z.null()]);

export const chartSpecSchema = z
  .object({
    type: z.enum(["bar", "line", "area", "pie"]).default("bar"),
    title: z.string().max(200).optional(),
    /** Row key for the category axis (or pie slice labels). */
    x: z.string().min(1).max(80).optional(),
    /** Numeric row keys to plot. Defaults to every numeric key except `x`. */
    series: z.array(z.string().min(1).max(80)).max(8).optional(),
    stacked: z.boolean().optional(),
    unit: z.string().max(12).optional(),
    data: z.array(z.record(z.string().max(80), cell)).min(1).max(500),
  })
  .strict();
export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const statItemSchema = z
  .object({
    label: z.string().min(1).max(80),
    value: z.union([z.string().max(40), z.number()]),
    delta: z.string().max(24).optional(),
    trend: z.enum(["up", "down", "flat"]).optional(),
    caption: z.string().max(120).optional(),
  })
  .strict();
export const statItemsSchema = z.array(statItemSchema).min(1).max(6);
export type StatItem = z.infer<typeof statItemSchema>;

// Drawing helpers live apart from the schemas, so mini apps' chart lib
// (src/minis/shelf/charts.tsx) doesn't ship zod.
export { SERIES_COLORS, resolveChart, type ResolvedChart } from "./chart-draw";

export function parseJsonWith<T>(schema: z.ZodType<T>, text: string): { ok: true; value: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${errorMessage(error)}` };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    };
  }
  return { ok: true, value: result.data };
}
