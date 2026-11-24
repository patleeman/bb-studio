import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ThreadTimelineViewRow } from "@bb/thread-view";
import type { IconName } from "@bb/shared-ui/icon";
import { parseAutomationDueMessage } from "@bb/client-core";
import {
  getPluginSlotSnapshot,
  subscribePluginSlots,
} from "@/lib/plugin-slots";
import {
  classifyPluginMessage,
  isQuietReply,
  type PluginMessageClassification,
  type ReplyClassifiers,
} from "@/lib/fork-reply-classifiers";
import { QuietTurnMarker } from "./ForkQuietTurnMarker.js";
import {
  expandTimelineFold,
  useTimelineFilterExpanded,
  useTimelineFoldsOf,
} from "@/lib/fork-timeline-filter";
import {
  foldTurnRuns,
  TurnRunMarkerLine,
  type TurnRunMarker,
} from "./turnRunFold.fork.js";
import {
  collectSearchedMessageAncestorRowIds,
  useSearchMessageLocation,
} from "./useScrollToSearchedMessage.js";
import {
  noticeFoldOf,
  noticeOf,
  type QuietFoldDetails,
} from "./noticeFold.fork.js";

const KEPT_OPERATIONS: ReadonlySet<string> = new Set([
  "warning",
  "deprecation",
  "provider-unhandled",
  "thread-interrupted",
]);

const KEPT_SYSTEM_KINDS: ReadonlySet<string> = new Set(["error", "reconnect"]);

const ALERT_MESSAGE_KINDS: ReadonlySet<string> = new Set([
  "child-failed",
  "child-needs-attention",
  "child-interrupted",
]);

const ALERT_ICONS: ReadonlySet<IconName> = new Set<IconName>([
  "AlertTriangle",
  "AlertCircle",
  "CircleX",
]);

const URGENT_BODY = /^(?:\[bb [^\]\n]*\]\s*)?(?:[^\n:]{0,80}:\s*)?⚠/u;

export type QuietFoldState =
  | "running"
  | "done"
  | "skipped"
  | "notice"
  | "failed"
  | "alert";

export interface QuietFold {
  label: string;
  state: QuietFoldState;
  createdAt: number;
  details?: QuietFoldDetails;
}

const QUIET_FOLD_PREFIX: Record<"running" | "done" | "skipped", string> = {
  running: "Compacting…",
  done: "Compacted",
  skipped: "Compaction skipped",
};

export class FoldedRows extends Set<string> {
  readonly quiet: ReadonlyMap<string, QuietFold>;
  /** Rows drawn as a plugin's folded run (turnRunFold.fork.tsx). */
  readonly runs: ReadonlyMap<string, TurnRunMarker>;

  constructor(
    ids: Iterable<string> = [],
    quiet: ReadonlyMap<string, QuietFold> = new Map(),
    runs: ReadonlyMap<string, TurnRunMarker> = new Map(),
  ) {
    super(ids);
    this.quiet = quiet;
    this.runs = runs;
  }
}

const NO_FOLDS = new FoldedRows();
const NO_TARGET: ReadonlySet<string> = new Set();
const MAX_CACHED_THREADS = 64;
const lastFoldedByThread = new Map<string, FoldedRows>();

function sameQuietDetails(
  a: QuietFoldDetails | undefined,
  b: QuietFoldDetails | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameFoldedRows(a: FoldedRows, b: FoldedRows): boolean {
  if (a === b) return true;
  if (a.size !== b.size || a.quiet.size !== b.quiet.size || a.runs.size !== b.runs.size) {
    return false;
  }
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  for (const [id, fold] of a.quiet) {
    const other = b.quiet.get(id);
    if (
      other === undefined ||
      fold.label !== other.label ||
      fold.state !== other.state ||
      fold.createdAt !== other.createdAt ||
      !sameQuietDetails(fold.details, other.details)
    ) {
      return false;
    }
  }
  for (const [id, run] of a.runs) {
    const other = b.runs.get(id);
    if (
      other === undefined ||
      run.foldId !== other.foldId ||
      run.threadId !== other.threadId ||
      run.label !== other.label
    ) {
      return false;
    }
  }
  return true;
}

/** Keeps the previous FoldedRows identity when streaming tokens leave folds unchanged, avoiding full-timeline context re-renders. */
function stabilizeFoldedRows(
  threadId: string | null,
  next: FoldedRows,
): FoldedRows {
  if (threadId === null || next === NO_FOLDS) return next;
  const previous = lastFoldedByThread.get(threadId);
  if (previous !== undefined && sameFoldedRows(previous, next)) {
    return previous;
  }
  lastFoldedByThread.delete(threadId);
  lastFoldedByThread.set(threadId, next);
  if (lastFoldedByThread.size > MAX_CACHED_THREADS) {
    const oldest = lastFoldedByThread.keys().next().value;
    if (oldest !== undefined) lastFoldedByThread.delete(oldest);
  }
  return next;
}

export const RelayedFoldContext = createContext<FoldedRows>(NO_FOLDS);
export const RelayedRowFoldedContext = createContext(false);

export interface RelayedFold {
  rows: readonly ThreadTimelineViewRow[];
  folded: FoldedRows;
}

export interface RelayedGeneratedSource {
  sourceKind: "agent";
  sourceName: string;
  sourceProjectId: null;
  sourceThreadId: null;
  sourceIsPluginSideChat: false;
}

export function isRelayedRow(
  row: ThreadTimelineViewRow,
  classifiers: ReplyClassifiers = getPluginSlotSnapshot().replyClassifiers,
): boolean {
  if (row.kind !== "conversation" || row.role !== "user") return false;
  if (row.initiator !== "user") return true;
  if (parseAutomationDueMessage(row.text) !== null) return true;
  return (
    classifyPluginMessage(
      row.text,
      { part: "message", initiator: "user" },
      classifiers,
    ) !== null
  );
}

export function isAlertRow(row: ThreadTimelineViewRow): boolean {
  if (row.kind !== "conversation" || row.role !== "user") return false;
  if (ALERT_MESSAGE_KINDS.has(row.systemMessageKind ?? "")) return true;
  return URGENT_BODY.test(row.text.trimStart());
}

function compactionReason(row: ThreadTimelineViewRow): string | null {
  if (row.kind !== "conversation" || row.role !== "user") return null;
  if (row.initiator !== "system") return null;
  const subject = row.systemMessageSubject;
  return subject?.kind === "compaction" ? subject.reason.trim() : null;
}

function isCompactionRow(row: ThreadTimelineViewRow): boolean {
  return (
    row.kind === "system" &&
    row.systemKind === "operation" &&
    row.operationKind === "compaction"
  );
}

function inQuietTurn(
  message: ThreadTimelineViewRow,
  row: ThreadTimelineViewRow,
): boolean {
  return message.turnId !== null
    ? row.turnId === message.turnId
    : isCompactionRow(row);
}

function rowStatus(row: ThreadTimelineViewRow): string | null {
  return "status" in row && typeof row.status === "string" ? row.status : null;
}

function quietFoldState(
  compaction: ThreadTimelineViewRow | undefined,
): keyof typeof QUIET_FOLD_PREFIX | null {
  const status = compaction === undefined ? "pending" : rowStatus(compaction);
  if (status === "error" || status === "interrupted") return null;
  if (status === "pending") return "running";
  return compaction !== undefined &&
    "title" in compaction &&
    /skipped/iu.test(compaction.title)
    ? "skipped"
    : "done";
}

function hiddenInQuietTurn(row: ThreadTimelineViewRow): boolean {
  if (isCompactionRow(row)) return true;
  const status = rowStatus(row);
  if (status === "pending" || status === "interrupted") return false;
  return hiddenInFold(row);
}

export function quietFoldOf(
  rows: readonly ThreadTimelineViewRow[],
  index: number,
): { fold: QuietFold; hidden: string[] } | null {
  const message = rows[index];
  if (message === undefined) return null;
  const reason = compactionReason(message);
  if (reason === null) return null;
  const turn: ThreadTimelineViewRow[] = [];
  for (
    let later = index + 1;
    later < rows.length && rows[later]!.kind !== "conversation";
    later += 1
  ) {
    if (inQuietTurn(message, rows[later]!)) turn.push(rows[later]!);
  }
  const state = quietFoldState(turn.filter(isCompactionRow).at(-1));
  if (state === null) return null;
  const prefix = QUIET_FOLD_PREFIX[state];
  return {
    fold: {
      label: reason.length > 0 ? `${prefix} · ${reason}` : prefix,
      state,
      createdAt: message.createdAt,
    },
    hidden: turn.filter(hiddenInQuietTurn).map((row) => row.id),
  };
}

function hiddenInFold(row: ThreadTimelineViewRow): boolean {
  if (row.kind === "system") {
    if (KEPT_SYSTEM_KINDS.has(row.systemKind)) return false;
    if (row.systemKind === "operation" && KEPT_OPERATIONS.has(row.operationKind)) {
      return false;
    }
  }
  return !("status" in row && row.status === "error");
}

export function foldRelayedRows(
  rows: readonly ThreadTimelineViewRow[],
  streamingAssistantMessageId: string | null,
  classifiers: ReplyClassifiers = getPluginSlotSnapshot().replyClassifiers,
  active: boolean = streamingAssistantMessageId !== null,
  targetRowIds: ReadonlySet<string> = NO_TARGET,
): RelayedFold {
  const relayed = (row: ThreadTimelineViewRow | undefined): boolean =>
    row !== undefined &&
    noticeOf(row) === null &&
    isRelayedRow(row, classifiers) &&
    !isAlertRow(row);
  const quiet = (row: ThreadTimelineViewRow | undefined): boolean =>
    row !== undefined &&
    row.kind === "conversation" &&
    row.role === "assistant" &&
    row.id !== streamingAssistantMessageId &&
    isQuietReply(row.text, classifiers);
  const nextConversation = (from: number): number => {
    let index = from;
    while (index < rows.length && rows[index]!.kind !== "conversation") {
      index += 1;
    }
    return index;
  };
  const hidden = new Set<string>();
  const folded = new Set<string>();
  const quietFolds = new Map<string, QuietFold>();
  for (const [index, row] of rows.entries()) {
    const quiet = quietFoldOf(rows, index);
    if (quiet === null) continue;
    quietFolds.set(row.id, quiet.fold);
    for (const id of quiet.hidden) hidden.add(id);
  }
  for (const [index, row] of rows.entries()) {
    const notice = noticeFoldOf(
      rows,
      index,
      quiet,
      streamingAssistantMessageId,
      active,
    );
    if (notice === null) continue;
    for (const id of notice.hidden) hidden.add(id);
    if (notice.hideRow) {
      hidden.add(row.id);
      continue;
    }
    quietFolds.set(row.id, {
      label: notice.label,
      state: notice.state,
      createdAt: row.createdAt,
      details: notice.details,
    });
  }
  for (let index = 0; index < rows.length; index += 1) {
    if (quietFolds.has(rows[index]!.id) || !relayed(rows[index])) continue;
    const group = new Set([index]);
    let reply = nextConversation(index + 1);
    while (relayed(rows[reply])) {
      group.add(reply);
      reply = nextConversation(reply + 1);
    }
    if (!quiet(rows[reply])) continue;
    let end = reply;
    for (
      let later = nextConversation(end + 1);
      quiet(rows[later]);
      later = nextConversation(end + 1)
    ) {
      end = later;
    }
    // A real reply after the quiet ones answers the group's last line: that
    // line stays as it is, without the check.
    const after = rows[nextConversation(end + 1)];
    const answered =
      after?.kind === "conversation" && after.role === "assistant"
        ? Math.max(...group)
        : -1;
    // A group holding the message a link points at stays as it is, so the jump lands on it.
    if (targetRowIds.size > 0 && rows.slice(index, end + 1).some((row) => targetRowIds.has(row.id))) {
      index = end;
      continue;
    }
    for (let at = index; at <= end; at += 1) {
      const row = rows[at]!;
      if (at === answered) continue;
      if (group.has(at)) folded.add(row.id);
      else if (row.kind === "conversation" || hiddenInFold(row)) hidden.add(row.id);
    }
    index = end;
  }
  if (folded.size === 0 && quietFolds.size === 0 && hidden.size === 0) {
    return { rows, folded: NO_FOLDS };
  }
  return {
    rows: rows.filter((row) => !hidden.has(row.id)),
    folded: new FoldedRows(folded, quietFolds),
  };
}

export function useRelayedFold(
  rows: readonly ThreadTimelineViewRow[],
  scopeActive: boolean,
  findStreamingAssistantMessageId: (
    rows: readonly ThreadTimelineViewRow[],
  ) => string | null,
): RelayedFold {
  const slots = useSyncExternalStore(
    subscribePluginSlots,
    getPluginSlotSnapshot,
    getPluginSlotSnapshot,
  );
  const unfold = useTimelineFilterExpanded();
  const threadId = rows[0]?.threadId ?? null;
  const runFolds = useTimelineFoldsOf(threadId);
  // A message link or search result into a folded run keeps that run open.
  const { target } = useSearchMessageLocation();
  // Only a link into this list's own thread (a delegation's nested list is another thread).
  const forThisThread =
    target !== null && (target.threadId === null || target.threadId === threadId);
  const targetSeq = forThisThread ? target.seq : null;
  const targetMatch = forThisThread ? target.match : null;
  const fold = useMemo(() => {
    if (unfold) return { rows, folded: NO_FOLDS, opened: NO_OPENED };
    const targetRowIds =
      targetSeq === null || targetMatch === null
        ? NO_TARGET
        : collectSearchedMessageAncestorRowIds(rows, targetSeq, targetMatch);
    const relayed = foldRelayedRows(
      rows,
      scopeActive ? findStreamingAssistantMessageId(rows) : null,
      slots.replyClassifiers,
      scopeActive,
      targetRowIds,
    );
    // A plugin's folded runs (status replies), over what the relayed fold left.
    const runs = foldTurnRuns(relayed.rows, runFolds, {
      isRelayed: (row) => isRelayedRow(row, slots.replyClassifiers),
      kept: keptInRunFold,
      isQuiet: (row) =>
        row.kind === "conversation" &&
        row.role === "assistant" &&
        isQuietReply(row.text, slots.replyClassifiers),
      targetRowIds,
    });
    if (runs.markers.size === 0) {
      return {
        rows: relayed.rows,
        folded: stabilizeFoldedRows(threadId, relayed.folded),
        opened: runs.opened,
      };
    }
    return {
      rows: runs.rows,
      folded: stabilizeFoldedRows(
        threadId,
        new FoldedRows(relayed.folded, relayed.folded.quiet, runs.markers),
      ),
      opened: runs.opened,
    };
  }, [rows, scopeActive, findStreamingAssistantMessageId, slots.replyClassifiers, unfold, runFolds, targetSeq, targetMatch, threadId]);
  const opened = fold.opened.join("\n");
  useEffect(() => {
    if (threadId === null || opened === "") return;
    for (const id of opened.split("\n")) expandTimelineFold(threadId, id);
  }, [threadId, opened]);
  return fold;
}

const NO_OPENED: readonly string[] = [];

/** What a folded run never hides: what the relayed fold keeps, alerts, and rows still running. */
function keptInRunFold(row: ThreadTimelineViewRow): boolean {
  const status = rowStatus(row);
  return (
    !hiddenInFold(row) ||
    isAlertRow(row) ||
    status === "pending" ||
    status === "interrupted"
  );
}

export function RelayedRowFolded({
  rowId,
  children,
}: {
  rowId: string;
  children: ReactNode;
}) {
  const folds = useContext(RelayedFoldContext);
  const run = folds.runs.get(rowId);
  if (run !== undefined) return <TurnRunMarkerLine marker={run} />;
  const quiet = folds.quiet.get(rowId);
  if (quiet !== undefined) {
    return (
      <QuietTurnMarker
        label={quiet.label}
        state={quiet.state}
        at={quiet.createdAt}
        details={quiet.details}
      />
    );
  }
  const folded = folds.has(rowId);
  return (
    <RelayedRowFoldedContext.Provider value={folded}>
      {children}
    </RelayedRowFoldedContext.Provider>
  );
}

export function relayedGeneratedSource(
  classification: PluginMessageClassification | null,
): RelayedGeneratedSource | null {
  if (classification === null) return null;
  return {
    sourceKind: "agent",
    sourceName: classification.sender ?? "BB Studio",
    sourceProjectId: null,
    sourceThreadId: null,
    sourceIsPluginSideChat: false,
  };
}

export function useRelayedLeadingIcon(icon: IconName): IconName {
  const folded = useContext(RelayedRowFoldedContext);
  return folded && !ALERT_ICONS.has(icon) ? "Check" : icon;
}
