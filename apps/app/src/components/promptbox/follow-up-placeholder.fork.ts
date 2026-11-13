import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";

export const FIRST_MESSAGE_PLACEHOLDER =
  "Ask anything. @ to mention files, folders, sections, or conversations";

export const COMPACT_FIRST_MESSAGE_PLACEHOLDER = "Ask anything";

function hasUserWrittenRow(rows: readonly TimelineRow[]): boolean {
  return rows.some((row) => {
    if (row.kind === "conversation") {
      return row.role === "user" && row.initiator === "user";
    }
    return row.kind === "turn" && row.children !== null
      ? hasUserWrittenRow(row.children)
      : false;
  });
}

export type ForkPlaceholderState = "first-message" | "signed-out" | null;

export const SIGNED_OUT_PLACEHOLDER =
  "Sign in or pick another model, then send again";
export const COMPACT_SIGNED_OUT_PLACEHOLDER = "Sign in, then send again";

const SIGN_IN_TITLE = / isn't signed in$/u;

function lastSettledRow(rows: readonly TimelineRow[]): TimelineRow | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row === undefined) continue;
    if (row.kind === "turn" && row.children !== null) {
      const inner = lastSettledRow(row.children);
      if (inner !== null) return inner;
      continue;
    }
    if (row.kind === "system" && row.systemKind !== "error") continue;
    return row;
  }
  return null;
}

export function forkPlaceholderState(
  rows: readonly TimelineRow[] | null | undefined,
  hasOlderRows: boolean,
): ForkPlaceholderState {
  if (rows == null) return null;
  const last = lastSettledRow(rows);
  if (
    last !== null &&
    last.kind === "system" &&
    last.systemKind === "error" &&
    typeof last.title === "string" &&
    SIGN_IN_TITLE.test(last.title)
  ) {
    return "signed-out";
  }
  if (hasOlderRows) return null;
  return hasUserWrittenRow(rows) ? null : "first-message";
}

export function threadHasNoUserMessage(
  rows: readonly TimelineRow[] | null | undefined,
  hasOlderRows: boolean,
): boolean {
  return forkPlaceholderState(rows, hasOlderRows) === "first-message";
}

export function forkPlaceholder(
  displayStatus: ThreadRuntimeDisplayStatus,
  state: ForkPlaceholderState | undefined,
  compact: boolean,
): string | null {
  if (state === "signed-out" && (displayStatus === "error" || displayStatus === "idle")) {
    return compact ? COMPACT_SIGNED_OUT_PLACEHOLDER : SIGNED_OUT_PLACEHOLDER;
  }
  if (state === "first-message" && displayStatus === "idle") {
    return compact ? COMPACT_FIRST_MESSAGE_PLACEHOLDER : FIRST_MESSAGE_PLACEHOLDER;
  }
  return null;
}
