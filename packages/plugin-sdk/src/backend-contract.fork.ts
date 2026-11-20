import type {
  Host,
  PermissionMode,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import type { ReadonlyJsonValue } from "./json-value.js";
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
   * Fork features this bb has, for a plugin that keeps an older bb's
   * behaviour without them. `threadNotices`: `sdk.threads.send` takes
   * `experimental_notice: { source, label }`, which makes the message the
   * system's and draws it as one quiet row. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  readonly experimental_features: {
    readonly threadNotices: true;
    readonly autoRouter: true;
    readonly textCompletion: true;
  };
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
  /**
   * Answer "Auto": bb lists an Auto provider (id `auto`, model `auto`) in the
   * model pickers while a router is registered and enabled, and resolves a
   * new thread created with it (or, when the router says Auto is the
   * default, one created without a provider) to the real provider and model
   * the router returns, before the thread exists. The thread never runs as
   * Auto. bb waits at most 8 seconds and cancels `signal` after that; a
   * router that returns null, throws or is late leaves the thread on the
   * usual defaults. One router per bb: a second registration replaces the
   * first. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_autoRouter(router: ExperimentalAutoRouter): void;
  /**
   * Answer one short prompt with the AI service the user picked for thread
   * titles (Settings → AI services): a single model call with no tools, no
   * thread and no workspace, which is what bb itself uses for titles. The
   * reply is cleaned to one line, as titles are. bb waits at most
   * `timeoutMs` (500-8000, default 8000) and the prompt is capped at 32,000
   * characters. Resolves `{ ok: false }` when the task is turned off, no
   * service is ready, or it failed or timed out. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_completeText(
    request: ExperimentalTextCompletionRequest,
  ): Promise<ExperimentalTextCompletionResult>;
}

export interface ExperimentalTextCompletionRequest {
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type ExperimentalTextCompletionResult =
  | { ok: true; text: string; service: string; ms: number }
  | {
      ok: false;
      reason: "off" | "unavailable" | "timeout" | "failed" | "cancelled";
      message: string;
      ms: number;
    };

/** The provider id the pickers use for Auto. */
export const EXPERIMENTAL_AUTO_PROVIDER_ID = "auto";

/** What bb asks an Auto router about a thread it is about to create. */
export interface ExperimentalAutoRouteRequest {
  projectId: string;
  /** The text of the first message, without agent-only context. */
  text: string;
  parentThreadId: string | null;
  originPluginId: string | null;
  /**
   * The permission mode asked for. bb narrows it to one the chosen provider
   * supports, never wider; a target that supports no mode at or below it
   * cannot honor it, so a router should skip it.
   */
  permissionMode: PermissionMode | null;
  signal: AbortSignal;
}

/** A real provider and model for the thread. */
export interface ExperimentalAutoRouteTarget {
  providerId: string;
  model: string;
  reasoningLevel?: ReasoningLevel | null;
  serviceTier?: ServiceTier | null;
}

export interface ExperimentalAutoRouter {
  /** Shown in the pickers; defaults to "Auto". */
  label?: string;
  /** Whether Auto is offered now. Defaults to true. */
  enabled?: () => boolean;
  /** Whether a thread created without a provider goes through Auto. */
  isDefault?: () => boolean;
  resolve(
    request: ExperimentalAutoRouteRequest,
  ):
    | ExperimentalAutoRouteTarget
    | null
    | Promise<ExperimentalAutoRouteTarget | null>;
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

/**
 * Fork fields of the context a provider's `deriveProviderOptions` receives.
 */
export interface ForkProviderOptionsContext {
  /**
   * The thread's metadata stored under the provider plugin's own id, or `{}`
   * when it has none. Any plugin can write it for a thread with
   * `bb.sdk.threads.updatePluginMetadata({ threadId, pluginId, set })`, and so
   * can any API client or the thread's own agent, so treat values as
   * untrusted. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_pluginMetadata?: { readonly [key: string]: ReadonlyJsonValue };
}
