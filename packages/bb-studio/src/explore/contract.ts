// Explore's RPC surface for its app: the Next row's click log. Zod only, so
// the app can import the types without server code.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { NEXT_KINDS } from "./next";
import { MAX_LABEL_LENGTH } from "./shared";

const threadId = z.string().min(1).max(200);
const messageId = z.string().min(1).max(200);

const nextItemSchema = z.object({ kind: z.enum(NEXT_KINDS), emoji: z.string().max(16), label: z.string().trim().min(1).max(MAX_LABEL_LENGTH * 2) });

export const rpcContract = defineRpcContract({
  /** A message's Next row was shown; logged once per suggestion. */
  "explore.nextShown": {
    input: z.object({ threadId, messageId, items: z.array(nextItemSchema).max(20) }),
    output: z.object({ ok: z.literal(true) }),
  },
  /** A Next suggestion was clicked. */
  "explore.nextClicked": {
    input: nextItemSchema.extend({ threadId, messageId }),
    output: z.object({ ok: z.literal(true) }),
  },
});
