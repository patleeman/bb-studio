import type { PromptInput, Thread } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import {
  buildThreadHandoffFollowUpDraft,
  isPromptDraftEmpty,
  promptInputToDraft,
  type PromptDraftState,
  type ThreadHandoffCreateSeed,
} from "@bb/client-core";
import { forkPlaceholderState } from "@/components/promptbox/follow-up-placeholder.fork";

export interface SignInRecovery {
  input: readonly PromptInput[];
  onlyMessage: boolean;
}

type ConversationRow = Extract<TimelineRow, { kind: "conversation" }>;
type UserRow = Extract<ConversationRow, { role: "user" }>;

function conversationRows(rows: readonly TimelineRow[]): ConversationRow[] {
  return rows.flatMap((row): ConversationRow[] => {
    if (row.kind === "conversation") return [row];
    if (row.kind === "turn" && row.children !== null) {
      return conversationRows(row.children);
    }
    return [];
  });
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
  const failed = conversation.filter(isUserWritten).at(-1);
  if (failed === undefined) return null;
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
