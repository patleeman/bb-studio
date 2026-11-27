// Settings › Agent context: lean context per provider (src/context-lean.ts).
import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// The frontend imports the contract; the SDK helper only returns its argument.
const defineRpcContract: typeof sdkDefineRpcContract = (contract) => contract;

export const leanModeSchema = z.enum(["auto", "lean", "full"]);

const providerRow = z.object({
  id: z.string(),
  name: z.string(),
  acp: z.boolean(),
  mode: leanModeSchema,
  /** Tools a Bot conversation loads with this provider: lean, and full. */
  tools: z.object({ lean: z.number().int(), full: z.number().int() }),
  /** How the rest arrive when full: the provider's own deferral, BB's defer flag, or studio_tool_*. */
  fullDelivery: z.enum(["native", "defer", "search"]),
});

export const contextLeanContract = defineRpcContract({
  "contextLean.get": { input: z.null(), output: z.object({ providers: z.array(providerRow) }) },
  "contextLean.set": { input: z.object({ providerId: z.string().min(1).max(200), mode: leanModeSchema }), output: z.object({ providers: z.array(providerRow) }) },
});

export type ContextLeanProvider = z.infer<typeof providerRow>;
