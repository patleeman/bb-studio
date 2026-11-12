import { z } from "zod";
import type { CheckLine } from "./checks";
import { presencePackageSchema } from "./schema";

export const PRESENCE_CHECK_CHANNEL_NAME = "studio-presence-check";
export const checkRequestSchema = z.object({ requestId: z.string().min(1).max(100), presence: presencePackageSchema });

export interface CheckBridgeDeps {
  canMeasure(): boolean;
  claim(requestId: string): Promise<boolean>;
  reply(requestId: string, results: CheckLine[]): Promise<unknown>;
  measure(code: string): Promise<CheckLine[]>;
}

export async function handleCheckRequest(payload: unknown, deps: CheckBridgeDeps): Promise<boolean> {
  const parsed = checkRequestSchema.safeParse(payload);
  if (!parsed.success || !deps.canMeasure()) return false;
  if (!(await deps.claim(parsed.data.requestId).catch(() => false))) return false;
  let results: CheckLine[];
  try { results = await deps.measure(parsed.data.presence.code); } catch (error) { results = [{ id: "runs", pass: false, reason: error instanceof Error ? error.message : String(error) }]; }
  await deps.reply(parsed.data.requestId, results.map((line) => ({ ...line, reason: line.reason.slice(0, 600) }))).catch(() => {});
  return true;
}
