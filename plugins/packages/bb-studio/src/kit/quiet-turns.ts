// Tells BB which turns are quiet, on a BB that asks (the BB Studio fork).
// BB keeps no rule of its own: Studio's `[PASS]` convention (./silent.ts) is
// registered on both sides, so the server skips the unread mark, the parent
// notice and the push, and the thread view draws the reply as a small
// "Quiet check" marker. On a BB without these hooks both calls do nothing.
import { isPassOutput } from "./silent";

interface TurnClassifierHooks {
  experimental_classifyTurns?: (classifier: (turn: { threadId: string; finalOutput: string | null }) => { quiet: boolean }) => void;
}

/** Backend half: `bb.experimental_hooks.experimental_classifyTurns`. Returns whether BB took it. */
export function registerQuietTurnClassifier(bb: { experimental_hooks?: object }): boolean {
  const hooks = bb.experimental_hooks as TurnClassifierHooks | undefined;
  if (typeof hooks?.experimental_classifyTurns !== "function") return false;
  hooks.experimental_classifyTurns(({ finalOutput }) => ({ quiet: isPassOutput(finalOutput) }));
  return true;
}

interface ReplyClassifierSlots {
  experimental_replyClassifier?: (registration: { id: string; classify: (text: string) => { quiet: boolean } }) => void;
}

/** Frontend half: `app.slots.experimental_replyClassifier`. Returns whether BB took it. */
export function registerQuietReplyClassifier(slots: object): boolean {
  const target = slots as ReplyClassifierSlots;
  if (typeof target.experimental_replyClassifier !== "function") return false;
  target.experimental_replyClassifier({ id: "pass", classify: (text) => ({ quiet: isPassOutput(text) }) });
  return true;
}
