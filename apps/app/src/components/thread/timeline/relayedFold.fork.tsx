import {
  createContext,
  useContext,
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

const NO_FOLDS: ReadonlySet<string> = new Set();

export const RelayedFoldContext = createContext<ReadonlySet<string>>(NO_FOLDS);
export const RelayedRowFoldedContext = createContext(false);

export interface RelayedFold {
  rows: readonly ThreadTimelineViewRow[];
  folded: ReadonlySet<string>;
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
): RelayedFold {
  const relayed = (row: ThreadTimelineViewRow | undefined): boolean =>
    row !== undefined && isRelayedRow(row, classifiers) && !isAlertRow(row);
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
  for (let index = 0; index < rows.length; index += 1) {
    if (!relayed(rows[index])) continue;
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
    for (let at = index; at <= end; at += 1) {
      const row = rows[at]!;
      if (group.has(at)) folded.add(row.id);
      else if (row.kind === "conversation" || hiddenInFold(row)) hidden.add(row.id);
    }
    index = end;
  }
  if (folded.size === 0) return { rows, folded: NO_FOLDS };
  return { rows: rows.filter((row) => !hidden.has(row.id)), folded };
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
  return useMemo(
    () =>
      foldRelayedRows(
        rows,
        scopeActive ? findStreamingAssistantMessageId(rows) : null,
        slots.replyClassifiers,
      ),
    [rows, scopeActive, findStreamingAssistantMessageId, slots.replyClassifiers],
  );
}

export function RelayedRowFolded({
  rowId,
  children,
}: {
  rowId: string;
  children: ReactNode;
}) {
  const folded = useContext(RelayedFoldContext).has(rowId);
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
