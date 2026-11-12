// A worker waiting on Patrick's approval (a command, a file change, a tool
// or a permission it asked for) doesn't bring the worker's composer back.
// The approval goes to the conversation that owns the worker (Main when it
// has none), as an Approve / Deny card:
//
//   ::approval{thread="thr_worker" id="int_…"}
//
// The card (src/ui/conversations/ApprovalCard.tsx) reads the worker's
// pending interaction through `bot_worker_approval` and resolves it through
// `bot_worker_approval_resolve`, which calls BB's own per-thread resolution
// (sdk.threads.interactions.resolve, what the composer's approval stack
// uses) with the resolution BB would build. The owning conversation shows as
// needing Patrick ("Approve: <short command>") until the approval is
// resolved, from the card or anywhere else (src/bot-nudge.ts raises it;
// src/bot-threads-server.ts clears it).
//
// A worker's question that is not an approval (BB's question stack) keeps
// "Answer it here" on the worker (src/ui/conversations/ReadOnlyComposer.tsx).
//
// The detail lines and the resolution follow BB's core-ui
// (packages/core-ui/src/pending-interaction-formatting.ts); Studio can't
// import it, so they are kept here in the same words.
import { z } from "zod";

export type ApprovalDecision = "allow_once" | "allow_for_session" | "deny";

type Permissions = {
  network?: { enabled?: boolean } | null;
  fileSystem?: { read: readonly string[]; write: readonly string[] } | null;
  macos?: unknown;
} | null;

type CommandAction = { type: string; path?: string | null; query?: string | null; command?: string };

/** What BB says a pending interaction is; only the fields the card reads. */
export interface Interaction {
  id: string;
  status?: string;
  payload?: {
    kind?: string;
    reason?: string | null;
    availableDecisions?: readonly string[];
    subject?: {
      kind?: string;
      command?: string;
      cwd?: string | null;
      actions?: readonly CommandAction[];
      sessionGrant?: Permissions;
      writeScope?: string | null;
      itemId?: string;
      toolName?: string | null;
      permissions?: Permissions;
      tool?: string;
      presentation?: { title?: string; detail?: string; label?: { pending?: string } };
      planFilePath?: string | null;
    } | null;
  } | null;
  resolution?: { decision?: string } | null;
}

/** Whether a pending interaction is an approval the card handles (a plan review stays BB's). */
export function isWorkerApproval(interaction: Pick<Interaction, "payload">): boolean {
  return interaction.payload?.kind === "approval" && !!interaction.payload.subject && interaction.payload.subject.kind !== "plan";
}

/** What a waiting worker waits on: an approval (the owner's card) or a question (Answer it here). */
export function waitingOn(interactions: readonly Interaction[]): "approval" | "question" | null {
  const pending = interactions.filter((each) => each.status === "pending");
  if (!pending.length) return null;
  return pending.some(isWorkerApproval) ? "approval" : "question";
}

function permissionSummary(permissions: Permissions): string[] {
  if (!permissions) return [];
  const out: string[] = [];
  if (permissions.network?.enabled === true) out.push("Network access");
  const fs = permissions.fileSystem;
  if (fs) {
    if (fs.read.length) out.push(fs.read.length === 1 ? "Read 1 path" : `Read ${fs.read.length} paths`);
    if (fs.write.length) out.push(fs.write.length === 1 ? "Write 1 path" : `Write ${fs.write.length} paths`);
  }
  return out;
}

function actionLine(action: CommandAction): string {
  switch (action.type) {
    case "read": return `Read ${action.path ?? ""}`.trim();
    case "listFiles": return action.path ? `List files in ${action.path}` : "List files";
    case "search": return action.query ? `Search for ${action.query}${action.path ? ` in ${action.path}` : ""}` : action.path ? `Search in ${action.path}` : "Search files";
    default: return action.command ?? "";
  }
}

/** The approval's detail lines, as BB's approval prompt shows them. */
export function approvalLines(interaction: Interaction): string[] {
  const subject = interaction.payload?.subject;
  if (!subject) return [];
  switch (subject.kind) {
    case "command": {
      const grant = permissionSummary(subject.sessionGrant ?? null);
      return [
        `Command: ${subject.command ?? ""}`,
        ...(subject.cwd ? [`Cwd: ${subject.cwd}`] : []),
        ...(subject.actions ?? []).map((action) => `Action: ${actionLine(action)}`),
        ...(grant.length ? [`Session grant: ${grant.join(", ")}`] : []),
      ];
    }
    case "file_change": {
      const grant = permissionSummary(subject.sessionGrant ?? null);
      return [
        ...(subject.itemId ? [`Item: ${subject.itemId}`] : []),
        ...(subject.writeScope ? [`Write root: ${subject.writeScope}`] : []),
        ...(grant.length ? [`Session grant: ${grant.join(", ")}`] : []),
      ];
    }
    case "permission_grant":
      return [...(subject.toolName ? [`Tool: ${subject.toolName}`] : []), ...permissionSummary(subject.permissions ?? null).map((each) => `Permission: ${each}`)];
    case "tool_use": {
      const presentation = subject.presentation ?? {};
      return [`Tool: ${subject.tool ?? ""}`, ...(presentation.title?.trim() ? [presentation.title] : []), ...(presentation.detail?.trim() ? [presentation.detail] : [])];
    }
    default:
      return [];
  }
}

/** The approval's title line: BB's reason, else what it asks for. */
export function approvalTitle(interaction: Interaction): string {
  const payload = interaction.payload;
  const subject = payload?.subject;
  if (payload?.reason?.trim()) return payload.reason.trim();
  switch (subject?.kind) {
    case "command": return "Run a command";
    case "file_change": return "Change files";
    case "permission_grant": return "Grant permissions";
    case "tool_use": return subject.presentation?.label?.pending?.trim() || `Use ${subject.tool ?? "a tool"}`;
    default: return "Approve an action";
  }
}

const SHORT_MAX = 60;
const shorten = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > SHORT_MAX ? `${line.slice(0, SHORT_MAX - 1)}…` : line;
};

/** A few words for the owning conversation's row: the command, else what it asks for. */
export function shortApproval(interaction: Interaction): string {
  const subject = interaction.payload?.subject;
  switch (subject?.kind) {
    case "command": return shorten(subject.command ?? "") || "a command";
    case "file_change": return subject.writeScope ? `write to ${shorten(subject.writeScope)}` : "file changes";
    case "permission_grant": return subject.toolName ? `${shorten(subject.toolName)} permissions` : "permissions";
    case "tool_use": return shorten(subject.presentation?.title?.trim() || subject.tool || "a tool");
    default: return shorten(approvalTitle(interaction));
  }
}

/** The needs-you reason on the owning conversation. */
export const approvalReason = (interaction: Interaction): string => `Approve: ${shortApproval(interaction)}`;

const DECISIONS: readonly ApprovalDecision[] = ["deny", "allow_for_session", "allow_once"];

/** The decisions BB offers for it, in the card's order (Deny, the always-allow variant, Approve). */
export function approvalDecisions(interaction: Interaction): ApprovalDecision[] {
  const offered = new Set(interaction.payload?.availableDecisions ?? []);
  return DECISIONS.filter((decision) => offered.has(decision));
}

/** The resolution BB's own approval buttons send for `decision`. */
export function approvalResolution(interaction: Interaction, decision: ApprovalDecision): { decision: "deny" } | { decision: "allow_once" | "allow_for_session"; grantedPermissions: unknown } {
  if (decision === "deny") return { decision };
  const subject = interaction.payload?.subject;
  let granted: unknown = null;
  if (subject?.kind === "permission_grant" && subject.permissions) {
    const permissions = subject.permissions;
    granted = {
      network: permissions.network?.enabled === true ? { enabled: true } : null,
      fileSystem: permissions.fileSystem ? { read: permissions.fileSystem.read, write: permissions.fileSystem.write } : null,
    };
  } else if (decision === "allow_for_session" && (subject?.kind === "command" || subject?.kind === "file_change")) {
    granted = subject.sessionGrant ?? null;
  }
  return { decision, grantedPermissions: granted };
}

export type ApprovalState = "pending" | "resolving" | "approved" | "approved-session" | "denied" | "gone";

/** Where the approval stands. "gone": BB no longer has it waiting (interrupted, or the turn ended). */
export function approvalState(interaction: Interaction | null | undefined): ApprovalState {
  if (!interaction) return "gone";
  if (interaction.status === "pending") return "pending";
  if (interaction.status === "resolving") return "resolving";
  if (interaction.status === "resolved") {
    const decision = interaction.resolution?.decision;
    return decision === "deny" ? "denied" : decision === "allow_for_session" ? "approved-session" : "approved";
  }
  return "gone";
}

export const approvalView = z.object({
  id: z.string(),
  state: z.enum(["pending", "resolving", "approved", "approved-session", "denied", "gone"]),
  title: z.string(),
  short: z.string(),
  lines: z.array(z.string()),
  decisions: z.array(z.enum(["allow_once", "allow_for_session", "deny"])),
});
export type ApprovalView = z.infer<typeof approvalView>;

/** The card's view of one interaction. */
export function viewOf(interaction: Interaction): ApprovalView {
  return { id: interaction.id, state: approvalState(interaction), title: approvalTitle(interaction), short: shortApproval(interaction), lines: approvalLines(interaction), decisions: approvalDecisions(interaction) };
}

/** The card's directive for one approval. */
export const approvalDirective = (threadId: string, interactionId: string): string => `::approval{thread="${threadId}" id="${interactionId}"}`;

const threadIdSchema = z.string().min(1).max(200);
const interactionIdSchema = z.string().min(1).max(200);

export const workerApprovalSchemas = {
  /** One worker's approval for the card in its conversation: the worker, and the approval (null when BB has no such interaction). */
  bot_worker_approval: {
    input: z.object({ threadId: threadIdSchema, interactionId: interactionIdSchema }),
    output: z.object({ worker: z.object({ threadId: z.string(), title: z.string(), projectId: z.string().nullable() }), approval: approvalView.nullable() }),
  },
  /**
   * The approvals a conversation's workers wait on now (Main: also the
   * workers with no conversation, or whose conversation is finished), oldest
   * first: the live cards Studio draws in that conversation.
   */
  bot_conversation_approvals: {
    input: z.object({ threadId: threadIdSchema }),
    output: z.object({ approvals: z.array(z.object({ worker: z.object({ threadId: z.string(), title: z.string(), projectId: z.string().nullable() }), approval: approvalView })) }),
  },
  /** Approve or deny it, through BB's own resolution; answers where it stands then. */
  bot_worker_approval_resolve: {
    input: z.object({ threadId: threadIdSchema, interactionId: interactionIdSchema, decision: z.enum(["allow_once", "allow_for_session", "deny"]) }),
    output: z.object({ approval: approvalView.nullable() }),
  },
};

type Sdk = {
  threads: {
    get(input: { threadId: string }): Promise<unknown>;
    interactions: {
      list(input: { threadId: string }): Promise<unknown>;
      resolve(input: { threadId: string; interactionId: string; resolution: unknown }): Promise<unknown>;
    };
  };
};

/** The two methods, on BB's SDK; `resolved` runs after a resolution (clears the owner's mark). */
export function workerApprovalRpc(deps: { sdk: Sdk; title(threadId: string, thread: { title?: string | null; titleFallback?: string | null } | null): string; resolved(threadId: string): void }) {
  const find = async (threadId: string, interactionId: string): Promise<Interaction | null> => {
    const list = await deps.sdk.threads.interactions.list({ threadId }).catch(() => []) as Interaction[];
    return list.find((each) => each.id === interactionId) ?? null;
  };
  const worker = async (threadId: string) => {
    const thread = await deps.sdk.threads.get({ threadId }).catch(() => null) as { title?: string | null; titleFallback?: string | null; projectId?: string | null } | null;
    return { threadId, title: deps.title(threadId, thread), projectId: thread?.projectId ?? null };
  };
  return {
    bot_worker_approval: async ({ threadId, interactionId }: { threadId: string; interactionId: string }) => {
      const [info, interaction] = await Promise.all([worker(threadId), find(threadId, interactionId)]);
      return { worker: info, approval: interaction && isWorkerApproval(interaction) ? viewOf(interaction) : null };
    },
    bot_worker_approval_resolve: async ({ threadId, interactionId, decision }: { threadId: string; interactionId: string; decision: ApprovalDecision }) => {
      const interaction = await find(threadId, interactionId);
      if (!interaction || !isWorkerApproval(interaction)) throw new Error("That approval isn't waiting any more.");
      if (interaction.status !== "pending") return { approval: viewOf(interaction) };
      if (!approvalDecisions(interaction).includes(decision)) throw new Error("BB doesn't offer that choice for this approval.");
      await deps.sdk.threads.interactions.resolve({ threadId, interactionId, resolution: approvalResolution(interaction, decision) });
      const after = await find(threadId, interactionId);
      const rest = await deps.sdk.threads.interactions.list({ threadId }).catch(() => []) as Interaction[];
      if (!rest.some((each) => each.status === "pending")) deps.resolved(threadId);
      // BB may report it resolving for a moment; the card reads it again.
      return { approval: after ? viewOf(after) : { ...viewOf(interaction), state: decision === "deny" ? "denied" as const : decision === "allow_for_session" ? "approved-session" as const : "approved" as const } };
    },
  };
}
