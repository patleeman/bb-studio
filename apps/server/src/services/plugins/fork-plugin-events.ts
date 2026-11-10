import {
  getHost,
  getLatestStoredThreadEventOfTypes,
  getThread,
  type ApplyThreadLifecycleEventArgs,
  type ApplyThreadLifecycleEventOutcome,
  type DbConnection,
} from "@bb/db";
import {
  systemThreadInterruptedEventDataSchema,
  type Host,
  type ThreadStatus,
} from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";
import {
  FORK_PLUGIN_EVENT_NAMES,
  type ExperimentalThreadFileChange,
  type ExperimentalTurnInterruptedReason,
  type ForkPluginEventPayloads,
} from "@get-bb/plugin-sdk";

type ForkEventName = keyof ForkPluginEventPayloads;

interface ForkEventWiring {
  emit<E extends ForkEventName>(
    event: E,
    build: () => ForkPluginEventPayloads[E] | null,
  ): void;
  db: DbConnection;
  buildThreadDto(
    thread: NonNullable<ReturnType<typeof getThread>>,
  ): ThreadResponse;
  toHostRecord(
    host: NonNullable<ReturnType<typeof getHost>>,
    status: "connected" | "disconnected",
  ): Host;
}

let wiring: ForkEventWiring | null = null;
const newDaemonInstance = new Map<string, boolean>();

export function registerForkPluginEvents(next: ForkEventWiring): void {
  wiring = next;
}

export function forkEventHandlerLists(): Record<ForkEventName, never[]> {
  return Object.fromEntries(
    FORK_PLUGIN_EVENT_NAMES.map((name) => [name, []]),
  ) as Record<ForkEventName, never[]>;
}

const INTERRUPTION_REASONS = new Set<string>([
  "manual-stop",
  "host-removed",
  "host-daemon-restarted",
  "host-connection-lost",
  "provider-turn-idle",
]);

function interruptionReason(
  db: DbConnection,
  threadId: string,
): ExperimentalTurnInterruptedReason | null {
  const latest = getLatestStoredThreadEventOfTypes(db, {
    threadId,
    types: ["system/thread/interrupted", "turn/started"],
    afterSequence: 0,
  });
  if (latest?.type !== "system/thread/interrupted") return null;
  let data: unknown = null;
  try {
    data = JSON.parse(latest.data);
  } catch {
    return null;
  }
  const parsed = systemThreadInterruptedEventDataSchema.safeParse(data).data;
  const reason = parsed?.cause ?? parsed?.reason;
  return typeof reason === "string" && INTERRUPTION_REASONS.has(reason)
    ? (reason as ExperimentalTurnInterruptedReason)
    : null;
}

export function announceTurnInterrupted(
  args: ApplyThreadLifecycleEventArgs,
  outcome: ApplyThreadLifecycleEventOutcome,
  previousStatus: ThreadStatus | undefined,
): void {
  if (wiring === null || !outcome.applied) return;
  if (previousStatus !== "active" && previousStatus !== "stopping") return;
  const eventType = args.event.type;
  if (eventType !== "stop.settled" && eventType !== "run.failed") return;
  const { db, emit, buildThreadDto } = wiring;
  emit("experimental_turn.interrupted", () => {
    const thread = getThread(db, args.threadId);
    if (thread === null) return null;
    const reason = interruptionReason(db, args.threadId);
    if (reason === null && eventType === "run.failed") return null;
    return { thread: buildThreadDto(thread), reason: reason ?? "provider" };
  });
}

export function noteDaemonInstance(
  hostId: string,
  sameInstance: boolean,
): void {
  newDaemonInstance.set(hostId, !sameInstance);
}

export function emitPluginHostConnected(hostId: string): void {
  if (wiring === null) return;
  const { db, emit, toHostRecord } = wiring;
  const restarted = newDaemonInstance.get(hostId) ?? true;
  emit("experimental_host.connected", () => {
    const host = getHost(db, hostId);
    return host === null
      ? null
      : { host: toHostRecord(host, "connected"), restarted };
  });
}

export function emitPluginHostDisconnected(
  hostId: string,
  reason: ForkPluginEventPayloads["experimental_host.disconnected"]["reason"],
): void {
  if (wiring === null) return;
  const { db, emit, toHostRecord } = wiring;
  emit("experimental_host.disconnected", () => {
    const host = getHost(db, hostId);
    return host === null
      ? null
      : { host: toHostRecord(host, "disconnected"), reason };
  });
}

const FILE_CHANGE_LOOKBACK_MS = 10_000;
const fileChangeCursors = new Map<string, number>();

interface FileChangeRow {
  sequence: number;
  item_id: string | null;
  data: string;
  created_at: number;
}

function readFileChanges(
  db: DbConnection,
  threadId: string,
  now: number,
): ExperimentalThreadFileChange[] {
  const cursor = fileChangeCursors.get(threadId);
  const rows = db.$client
    .prepare<[string, number], FileChangeRow>(
      `SELECT sequence, item_id, data, created_at FROM events
       WHERE thread_id = ? AND type = 'item/completed' AND item_kind = 'fileChange' AND sequence > ?
       ORDER BY sequence`,
    )
    .all(threadId, cursor ?? -1);
  const changes: ExperimentalThreadFileChange[] = [];
  let newest = cursor ?? -1;
  for (const row of rows) {
    newest = Math.max(newest, row.sequence);
    if (
      cursor === undefined &&
      now - row.created_at > FILE_CHANGE_LOOKBACK_MS
    ) {
      continue;
    }
    let item: unknown;
    try {
      item = (JSON.parse(row.data) as { item?: unknown }).item;
    } catch {
      continue;
    }
    const list = (item as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(list)) continue;
    for (const change of list as Record<string, unknown>[]) {
      const kind = change?.kind;
      if (
        typeof change?.path !== "string" ||
        (kind !== "add" && kind !== "update" && kind !== "delete")
      ) {
        continue;
      }
      changes.push({
        itemId: row.item_id ?? "",
        path: change.path,
        kind,
        ...(typeof change.movePath === "string"
          ? { movePath: change.movePath }
          : {}),
      });
    }
  }
  fileChangeCursors.set(threadId, newest);
  return changes;
}

export function announceThreadFilesChanged(threadId: string): void {
  if (wiring === null) return;
  const { db, emit, buildThreadDto } = wiring;
  emit("experimental_thread.fileChanged", () => {
    const changes = readFileChanges(db, threadId, Date.now());
    if (changes.length === 0) return null;
    const thread = getThread(db, threadId);
    return thread === null ? null : { thread: buildThreadDto(thread), changes };
  });
}
