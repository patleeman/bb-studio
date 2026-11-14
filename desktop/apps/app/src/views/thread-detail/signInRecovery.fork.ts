import type { PromptInput, Thread } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import {
  arePromptDraftStatesEqual,
  buildThreadHandoffFollowUpDraft,
  emptyPromptDraftState,
  isPromptDraftEmpty,
  stripThreadHandoffPrefix,
  promptInputToDraft,
  type PromptDraftState,
  type ThreadHandoffCreateSeed,
} from "@bb/client-core";
import { parseAutomationDueMessage } from "@bb/client-core";
import { forkPlaceholderState } from "@/components/promptbox/follow-up-placeholder.fork";
import { classifyPluginMessage } from "@/lib/fork-reply-classifiers";

export interface SignInRecovery {
  input: readonly PromptInput[];
  onlyMessage: boolean;
}

type ConversationRow = Extract<TimelineRow, { kind: "conversation" }>;
type UserRow = Extract<ConversationRow, { role: "user" }>;

function flatRows(rows: readonly TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row): TimelineRow[] =>
    row.kind === "turn" && row.children !== null ? flatRows(row.children) : [row],
  );
}

function conversationRows(rows: readonly TimelineRow[]): ConversationRow[] {
  return flatRows(rows).filter(
    (row): row is ConversationRow => row.kind === "conversation",
  );
}

const SIGN_IN_TITLE = / isn't signed in$/u;

function isSignInError(row: TimelineRow): boolean {
  return (
    row.kind === "system" &&
    row.systemKind === "error" &&
    typeof row.title === "string" &&
    SIGN_IN_TITLE.test(row.title)
  );
}

function isRelayedLine(text: string): boolean {
  return (
    parseAutomationDueMessage(text) !== null ||
    classifyPluginMessage(text, { part: "message", initiator: "user" }) !== null
  );
}

function messageOfFailedTurn(rows: readonly TimelineRow[]): UserRow | null {
  const flat = flatRows(rows);
  let errorIndex = -1;
  for (let index = flat.length - 1; index >= 0; index -= 1) {
    if (isSignInError(flat[index]!)) {
      errorIndex = index;
      break;
    }
  }
  if (errorIndex < 0) return null;
  const turnId = flat[errorIndex]!.turnId;
  if (turnId == null) return null;
  for (let index = errorIndex - 1; index >= 0; index -= 1) {
    const row = flat[index]!;
    if (row.turnId != null && row.turnId !== turnId) return null;
    if (row.kind !== "conversation") continue;
    return isUserWritten(row) && !isRelayedLine(row.text) ? row : null;
  }
  return null;
}

function isUserWritten(row: ConversationRow): row is UserRow {
  return row.role === "user" && row.initiator === "user";
}

function rowInput(row: UserRow): PromptInput[] {
  const input: PromptInput[] = [];
  if (row.text.trim().length > 0) {
    input.push({ type: "text", text: row.text, mentions: [...row.mentions] });
  }
  for (const path of row.attachments?.localImagePaths ?? []) {
    input.push({ type: "localImage", path });
  }
  for (const path of row.attachments?.localFilePaths ?? []) {
    const detail = row.attachments?.localFileDetails.find(
      (file) => file.path === path,
    );
    input.push({
      type: "localFile",
      path,
      ...(detail ? { name: detail.name } : {}),
      ...(detail?.sizeBytes == null ? {} : { sizeBytes: detail.sizeBytes }),
    });
  }
  return input;
}

const recoveries = new WeakMap<
  readonly TimelineRow[],
  { hasOlderRows: boolean; recovery: SignInRecovery | null }
>();

export function signInRecovery(
  rows: readonly TimelineRow[] | null | undefined,
  hasOlderRows: boolean,
): SignInRecovery | null {
  if (rows == null) return null;
  const cached = recoveries.get(rows);
  if (cached?.hasOlderRows === hasOlderRows) return cached.recovery;
  const recovery = findSignInRecovery(rows, hasOlderRows);
  recoveries.set(rows, { hasOlderRows, recovery });
  return recovery;
}

function findSignInRecovery(
  rows: readonly TimelineRow[],
  hasOlderRows: boolean,
): SignInRecovery | null {
  if (forkPlaceholderState(rows, hasOlderRows) !== "signed-out") {
    return null;
  }
  const conversation = conversationRows(rows);
  const failed = messageOfFailedTurn(rows);
  if (failed === null) return null;
  const input = rowInput(failed);
  if (input.length === 0) return null;
  return {
    input,
    onlyMessage: !hasOlderRows && conversation.every(isUserWritten),
  };
}

export function signInRecoveryHandoffDraft(
  seed: ThreadHandoffCreateSeed,
  current: PromptDraftState,
  recovery: SignInRecovery | null | undefined,
): PromptDraftState {
  if (recovery == null) return buildThreadHandoffFollowUpDraft(seed, current);
  const base = isPromptDraftEmpty(current)
    ? promptInputToDraft(recovery.input)
    : current;
  return recovery.onlyMessage
    ? base
    : buildThreadHandoffFollowUpDraft(seed, base);
}

export function signInRecoveryExitDraft(
  seed: ThreadHandoffCreateSeed,
  current: PromptDraftState,
  recovery: SignInRecovery | null | undefined,
): PromptDraftState | null {
  const stripped = stripThreadHandoffPrefix(seed, current);
  if (
    recovery != null &&
    arePromptDraftStatesEqual(stripped ?? current, promptInputToDraft(recovery.input))
  ) {
    return emptyPromptDraftState();
  }
  return stripped;
}

export function signInRecoveryTitle(
  thread: Pick<Thread, "title" | "titleFallback">,
  recovery: SignInRecovery | null | undefined,
): { title: string } | null {
  if (recovery == null) return null;
  const title = recovery.onlyMessage
    ? thread.title
    : (thread.title ?? thread.titleFallback);
  return title == null || title.trim().length === 0 ? null : { title };
}
