// The RPC W3's move command calls at move time (src/provider-move/handoff.ts).
import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const defineRpcContract: typeof sdkDefineRpcContract = (contract) => contract;

const side = z.object({ providerId: z.string().min(1).max(200), model: z.string().max(200).nullable().optional() });

export const moveProviderContract = defineRpcContract({
  "moveProvider.prepare": {
    input: z.object({
      threadId: z.string().min(1).max(200),
      from: side,
      to: side.extend({ permissionMode: z.string().max(50).nullable().optional() }),
      /** The verbatim budget in tokens (≈ chars / 4); 150k when left out. */
      historyTokens: z.number().int().positive().max(1_000_000).optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      transcriptPath: z.string().nullable(),
      verbatimTurns: z.number().int(),
      outlinedTurns: z.number().int(),
      bytes: z.number().int(),
      error: z.string().optional(),
    }),
  },
});
