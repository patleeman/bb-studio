import type { Host } from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";

/**
 * A turn that just finished, as a turn classifier sees it. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalCompletedTurn {
  threadId: string;
  /** The final root reply of the turn, or null when it had none. */
  finalOutput: string | null;
}

/**
 * What a classifier says about a finished turn. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalTurnClassification {
  /**
   * The agent had nothing to say. bb leaves the thread read, posts no
   * completion notice to its parent and sends no notification, and the
   * `thread.idle` event carries `experimental_quiet`.
   */
  quiet?: boolean;
}

/**
 * Classifies a finished turn. Runs inside the server while the turn
 * completes, so it must be synchronous, pure and fast. Return null or
 * undefined to say nothing. Experimental: see docs/api_to_audit.fork.md.
 */
export type ExperimentalTurnClassifier = (
  turn: ExperimentalCompletedTurn,
) => ExperimentalTurnClassification | null | undefined;

/**
 * Asked before bb deletes a thread, once for the thread and once for each
 * thread deleted with it. It may take its time (write an export, say). If it
 * throws, the deletion is refused and the error's message is shown.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export type ExperimentalBeforeThreadDeleteHandler = (context: {
  threadId: string;
}) => void | Promise<void>;

/**
 * What a plugin asks a person to approve. bb shows it in a dialog the plugin
 * does not draw: a native dialog in the desktop app, or bb's own dialog in a
 * browser that was paired from the desktop app. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalApprovalRequest {
  title: string;
  message: string;
  /** Smaller text under the message. */
  detail?: string;
  /** Things the person can allow one by one; none means a plain yes or no. */
  items?: readonly { id: string; label: string }[];
  /** The approve button's label. Defaults to "Approve". */
  confirmLabel?: string;
}

/**
 * The person's answer. `picked` holds the ids of the items they allowed
 * (always a subset of what was asked; empty when denied). An approval nobody
 * answers in ten minutes counts as denied. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalApprovalDecision {
  approved: boolean;
  picked: string[];
}

/**
 * Text a plugin adds to the agent's context at the start of each turn in a
 * thread. Return null or undefined (or an empty string) to add nothing.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export type ExperimentalTurnContextProvider = (context: {
  threadId: string;
}) => string | null | undefined | Promise<string | null | undefined>;

export type ExperimentalSkillsRegistryOperation = "search" | "read" | "install";

export type ExperimentalSkillsRegistryDecision =
  | { allowed: true }
  | { allowed: false; message: string };

export type ExperimentalSkillsRegistryCaller =
  | { kind: "app" }
  | { kind: "cli" }
  | { kind: "agent"; threadId: string };

export type ExperimentalSkillsRegistryPolicy = (request: {
  operation: ExperimentalSkillsRegistryOperation;
  caller: ExperimentalSkillsRegistryCaller;
}) =>
  | ExperimentalSkillsRegistryDecision
  | Promise<ExperimentalSkillsRegistryDecision>;

/** Hooks the fork adds to `bb.experimental_hooks`. */
export interface ForkPluginHooks {
  /**
   * Answer "what kind of turn was this?" for every turn that finishes. One
   * classifier per plugin; a second call replaces the first. A turn is quiet
   * when any plugin's classifier says so. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_classifyTurns(classifier: ExperimentalTurnClassifier): void;
  /**
   * Do something before a thread is deleted, or refuse the deletion by
   * throwing. One handler per plugin; a second call replaces the first.
   * Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_beforeThreadDelete(
    handler: ExperimentalBeforeThreadDeleteHandler,
  ): void;
  /**
   * Ask a person to approve something, and wait for the answer. Only a
   * person in the bb app can answer: agents, the CLI and plugins can ask but
   * cannot approve. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_requestApproval(
    request: ExperimentalApprovalRequest,
  ): Promise<ExperimentalApprovalDecision>;
  /**
   * Add text to the agent's context at the start of every turn: each time
   * bb starts a thread or sends a message that starts a new turn (not a
   * message steered into a running turn). bb calls the provider with the
   * thread id and puts what it returns, under a line naming the plugin,
   * after the turn's own input as an agent-only item: the agent reads it,
   * the timeline does not show it. It is bounded: bb waits at most 500 ms
   * for all providers, keeps at most 8000 characters per plugin, and
   * ignores a provider that throws, rejects or is late. One provider per
   * plugin; a second call replaces the first. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_turnContext(provider: ExperimentalTurnContextProvider): void;
  experimental_skillsRegistryPolicy(
    policy: ExperimentalSkillsRegistryPolicy,
  ): void;
  /**
   * Where thread `threadId` was forked from: its source thread and the
   * source turn its copied history ends with. Resolves null when the thread
   * does not exist, is not a fork, or its source was deleted. A fork's
   * `ThreadResponse` (in `thread.created` and `bb.sdk.threads.get`) already
   * has `sourceThreadId` and `originKind: "fork"`; this adds the point in
   * the source. It reads the thread's events, so it also works for forks
   * made before it existed. A lookup, not a hook: it lives here because the
   * fork adds nothing to the top of `bb`. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_threadForkPoint(
    threadId: string,
  ): Promise<ExperimentalThreadForkPoint | null>;
}

/**
 * Where a forked thread branched off its source: the source thread and the
 * last source turn whose history the fork copied. `sourceTurnId` and
 * `sourceSequence` (the sequence of that turn's `turn/completed` event in
 * the source thread) are null when the fork copied no history, for example
 * a hidden fork or one made before the source finished a turn.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalThreadForkPoint {
  sourceThreadId: string;
  sourceTurnId: string | null;
  sourceSequence: number | null;
}

/** Fields the fork adds to the `thread.idle` event payload. */
export interface ForkThreadIdlePayload {
  /**
   * True when a turn classifier called the turn quiet: the agent had nothing
   * to say. A plugin that reacts to finished turns should stay quiet too.
   * Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_quiet?: boolean;
}

/**
 * Why a turn ended without finishing: the person stopped it
 * (`manual-stop`), its machine was removed (`host-removed`), the host
 * daemon restarted or its connection was lost (`host-daemon-restarted`,
 * `host-connection-lost`), the provider never started the turn
 * (`provider-turn-idle`), or the provider reported the turn interrupted with
 * no recorded cause (`provider`). Experimental: see
 * docs/api_to_audit.fork.md.
 */
export type ExperimentalTurnInterruptedReason =
  | "manual-stop"
  | "host-removed"
  | "host-daemon-restarted"
  | "host-connection-lost"
  | "provider-turn-idle"
  | "provider";

/** Events the fork adds to `bb.events`. */
export interface ForkPluginEventPayloads {
  /**
   * A turn ended without finishing. bb also emits `thread.idle` or
   * `thread.failed` for the same turn; this one says why. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  "experimental_turn.interrupted": {
    thread: ThreadResponse;
    reason: ExperimentalTurnInterruptedReason;
  };
  /**
   * A machine's host daemon connected. `restarted` is true when it is a new
   * daemon process, not the same one reconnecting. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  "experimental_host.connected": { host: Host; restarted: boolean };
  /**
   * A machine's host daemon went away: its connection closed
   * (`daemon-disconnect`), it stopped answering (`expired`), or the machine
   * was removed (`removed`). Experimental: see docs/api_to_audit.fork.md.
   */
  "experimental_host.disconnected": {
    host: Host;
    reason: "daemon-disconnect" | "expired" | "removed";
  };
  /**
   * An agent in this thread finished changing files (an edit, a write or a
   * patch completed). Sent once per batch of new changes, in order.
   * Experimental: see docs/api_to_audit.fork.md.
   */
  "experimental_thread.fileChanged": {
    thread: ThreadResponse;
    changes: ExperimentalThreadFileChange[];
  };
}

/** One file an agent changed, as `experimental_thread.fileChanged` reports it. */
export interface ExperimentalThreadFileChange {
  /** The provider item (one edit, write or patch) the change belongs to. */
  itemId: string;
  /** The path as the agent's tool reported it; usually absolute. */
  path: string;
  kind: "add" | "update" | "delete";
  /** The new path when the change moved the file. */
  movePath?: string;
}

/** The fork's event names, for tables that list every event. */
export const FORK_PLUGIN_EVENT_NAMES = [
  "experimental_turn.interrupted",
  "experimental_host.connected",
  "experimental_host.disconnected",
  "experimental_thread.fileChanged",
] as const satisfies readonly (keyof ForkPluginEventPayloads)[];
