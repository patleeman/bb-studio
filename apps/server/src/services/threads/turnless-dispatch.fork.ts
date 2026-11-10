import type { PromptInput, Thread } from "@bb/domain";

export function startsNoTurn(
  thread: Pick<Thread, "originKind" | "status">,
  input: readonly PromptInput[],
): boolean {
  return (
    thread.status === "pending" &&
    thread.originKind === "fork" &&
    input.length === 0
  );
}
