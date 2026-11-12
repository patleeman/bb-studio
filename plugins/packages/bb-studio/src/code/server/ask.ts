// What the user asks BB from inside VS Code: a question about the code they
// point at, a new thread started from it, or the same file shown in BB. The
// bridge extension sends these over `/call`, beside the review comments.
import { z } from "zod";

const pointed = {
  path: z.string().min(1).max(4096),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  /** The selection, or the cursor's line; the extension cuts it to a few thousand characters. */
  text: z.string().max(10_000),
  language: z.string().max(100),
  question: z.string().trim().min(1).max(20_000),
};

/** What the bridge extension may ask for, besides review comments. */
export const editorCallSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("ask"), ...pointed }),
  z.object({ method: z.literal("newThread"), ...pointed }),
  z.object({ method: z.literal("showInBb"), path: z.string().min(1).max(4096), line: z.number().int().min(1) }),
]);
export type EditorCall = z.infer<typeof editorCallSchema>;

const METHODS: readonly string[] = ["ask", "newThread", "showInBb"];

/** Whether a `/call` body is one of these, not a review comment call. */
export function isEditorCall(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && METHODS.includes(String((raw as { method?: unknown }).method));
}

/** The message a question becomes: the question, then where the code is and the code itself. */
export function selectionMessage(input: { question: string; shown: string; startLine: number; endLine: number; text: string; language: string }): string {
  const end = Math.max(input.endLine, input.startLine);
  const where = `${input.shown}:${input.startLine}${end > input.startLine ? `–${end}` : ""}`;
  const fence = input.text.includes("```") ? "````" : "```";
  return `${input.question}\n\n${where}\n${fence}${input.language}\n${input.text}\n${fence}`;
}
