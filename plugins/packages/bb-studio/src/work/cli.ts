import { parseFlags, usage } from "../kit/cli";
import { changes, createInput, type WorkCard } from "./contract";
import type { registerWorkCards } from "./register";

export const WORK_USAGE = "bb studio work <create|update|show|list> …\n  create --title <text> [--kind worker|lead|release|todo|task] [--state <state>] [--step <text>] [--line <text>] [--needs <text>] [--thread <thr_…>] [--worker <thr_…>]\n  update <wc_…> [--state running|waiting|needs-you|done|failed] [--step <text>] [--line <text>] [--needs <text>] [--title <text>]\n  show <wc_…>\n  list [--thread <thr_…>]\n  Add --json for JSON.";

type Result = { exitCode: number; stdout?: string; stderr?: string };
type Work = ReturnType<typeof registerWorkCards>;

export function workLine(card: WorkCard): string {
  const parts = [card.id, card.state, card.title, card.step, card.line, card.state === "needs-you" ? card.needs : null].filter((part): part is string => !!part);
  return parts.join("\t");
}

export async function runWorkCli(argv: readonly string[], work: Work, ctx: { threadId?: string | null }): Promise<Result> {
  const [command, ...rest] = argv;
  const { positional, values } = parseFlags(rest, ["json"]);
  const json = "json" in values;
  const out = (value: unknown, text: string): Result => ({ exitCode: 0, stdout: `${json ? JSON.stringify(value, null, 2) : text}\n` });
  const blank = (key: string) => (key in values ? values[key] ?? "" : undefined);
  try {
    switch (command) {
      case "create": {
        const threadId = values.thread || ctx.threadId || undefined;
        if (!values.title) return usage(WORK_USAGE);
        if (!threadId) return { exitCode: 1, stderr: "Pass --thread: the conversation the card goes in.\n" };
        const input = createInput.parse({ title: values.title, kind: values.kind || undefined, state: values.state || undefined, step: values.step || undefined, line: values.line || undefined, needs: values.needs || undefined, workerThreadId: values.worker || undefined });
        const { card, directive } = work.create({ ...input, threadId });
        return out({ card, directive }, `${card.id}\nPost this line once in ${threadId}:\n${directive}`);
      }
      case "update": {
        const id = positional[0];
        if (!id) return usage(WORK_USAGE);
        const patch = changes.parse({ title: values.title || undefined, kind: values.kind || undefined, state: values.state || undefined, step: blank("step"), line: blank("line"), needs: blank("needs") });
        const card = work.update(id, patch);
        return out(card, workLine(card));
      }
      case "show": {
        const id = positional[0];
        if (!id) return usage(WORK_USAGE);
        const card = work.store.get(id);
        return out(card, workLine(card));
      }
      case "list": {
        const threadId = values.thread || ctx.threadId;
        if (!threadId) return { exitCode: 1, stderr: "Pass --thread: the conversation whose cards to list.\n" };
        const { cards } = await work.list(threadId);
        return out(cards, cards.length ? cards.map(workLine).join("\n") : "No work in flight.");
      }
      default:
        return usage(WORK_USAGE);
    }
  } catch (error) {
    return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }
}
