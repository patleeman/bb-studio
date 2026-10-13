// Notes: a thread's composer draft expanded into a page (src/pages/notes.ts).
// Studio's `notes.*` RPC methods. The desktop composer and iOS call them;
// scripts/gen-contracts.mjs generates the Swift names from public-contract.ts.
// The app imports only its types: values from here pull the root SDK into the
// frontend bundle, which BB can't install.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MAX_NOTE_TEXT } from "./constants";

export { MAX_NOTE_TEXT, SEND_INLINE_LIMIT } from "./constants";

const pageId = z.string().min(1).max(200);
const threadId = z.string().min(1).max(200);

export const noteStateSchema = z.enum(["open", "sent", "kept"]);

export const noteViewSchema = z.object({
  pageId: z.string(),
  threadId: z.string(),
  title: z.string(),
  /** `open` while it's a temp note on its thread; `sent` and `kept` are ordinary pages in Notes. */
  state: noteStateSchema,
  /** The page in Studio, e.g. /plugins/studio/studio/pages/pg_… */
  href: z.string(),
  /** Characters of Markdown in the page now. */
  length: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type NoteView = z.infer<typeof noteViewSchema>;
export type NoteState = z.infer<typeof noteStateSchema>;
export type NoteSendMode = "content" | "summarize";

export const rpcContract = defineRpcContract({
  "notes.create": {
    experimental_description:
      "Turns a thread's draft into a temp note: a page in Notes, titled \"Notes · Oct 13, 2:05 PM · <thread title>\", linked to the thread. When the thread already has an open note, the text is added to the end of it instead.",
    input: z.object({
      threadId,
      text: z.string().max(MAX_NOTE_TEXT),
      /** IANA time zone for the title's time, e.g. Europe/Paris. Default: the server's. */
      timeZone: z.string().max(100).optional(),
    }),
    output: z.object({ note: noteViewSchema, appended: z.boolean() }),
  },
  "notes.forThread": {
    experimental_description: "The thread's open note, or null.",
    input: z.object({ threadId }),
    output: z.object({ note: noteViewSchema.nullable() }),
  },
  "notes.forPage": {
    experimental_description: "The note a page is, open or resolved, or null for an ordinary page.",
    input: z.object({ pageId }),
    output: z.object({ note: noteViewSchema.nullable() }),
  },
  "notes.send": {
    experimental_description:
      "Sends an open note to its thread: the Markdown as the message (content), or a link and \"Summarize these notes\" (summarize). auto picks content up to 8,000 characters. The page stays in Notes as an ordinary page.",
    input: z.object({ pageId, mode: z.enum(["auto", "content", "summarize"]).optional() }),
    output: z.object({ note: noteViewSchema, sent: z.enum(["content", "summarize"]) }),
  },
  "notes.keep": {
    experimental_description: "Keeps an open note as an ordinary page with this title. It stays tagged Notes.",
    input: z.object({ pageId, title: z.string().trim().min(1).max(200) }),
    output: z.object({ note: noteViewSchema }),
  },
  "notes.discard": {
    experimental_description: "Deletes an open note's page.",
    input: z.object({ pageId }),
    output: z.object({ ok: z.boolean() }),
  },
});
