import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ChannelApproval, Job } from "./contract";
import { missingThread } from "./runtime";
import type { Store } from "./store";

type Interaction = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["get"]>
>;

/** Reads as a predicate after the bot's name: "Designer wants to run …". */
function approvalTitle(subject: Extract<Interaction["payload"], { kind: "approval" }>["subject"]) {
  switch (subject.kind) {
    case "command":
      return `wants to run \`${subject.command}\``;
    case "file_change":
      return subject.writeScope
        ? `wants to change files in ${subject.writeScope}`
        : "wants to change files";
    case "permission_grant":
      return subject.toolName
        ? `wants extra permissions for ${subject.toolName}`
        : "wants extra permissions";
    case "plan":
      return "wants to run its plan";
    case "tool_use":
      return (
        subject.presentation.label.pending || `wants to use ${subject.tool}`
      );
  }
}

function approvalDetail(payload: Extract<Interaction["payload"], { kind: "approval" }>) {
  const subject = payload.subject;
  const details = [payload.reason?.trim()];
  if (subject.kind === "command" && subject.cwd)
    details.push(`Working directory: ${subject.cwd}`);
  if (subject.kind === "permission_grant") {
    const files = subject.permissions.fileSystem;
    if (files?.read.length) details.push(`Read: ${files.read.join(", ")}`);
    if (files?.write.length) details.push(`Write: ${files.write.join(", ")}`);
    if (subject.permissions.network?.enabled)
      details.push("Network access requested");
  }
  if (subject.kind === "plan") details.push(subject.plan);
  if (subject.kind === "tool_use" && subject.presentation.detail)
    details.push(subject.presentation.detail);
  return details.filter(Boolean).join("\n\n") || null;
}

export function approvalView(
  interaction: Interaction,
  context: { roomId: string; botId: string; jobId: string | null },
): ChannelApproval {
  const base = {
    id: interaction.id,
    threadId: interaction.threadId,
    botId: context.botId,
    roomId: context.roomId,
    jobId: context.jobId,
    createdAt: interaction.createdAt,
  };
  const payload = interaction.payload;
  if (payload.kind === "approval")
    return {
      ...base,
      kind: "approval",
      title: approvalTitle(payload.subject),
      detail: approvalDetail(payload),
      decisions: payload.availableDecisions,
      questions: [],
    };
  if (payload.kind === "user_question")
    return {
      ...base,
      kind: "question",
      title: payload.questions.length === 1 ? "has a question" : `has ${payload.questions.length} questions`,
      detail: null,
      decisions: [],
      questions: payload.questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        multiSelect: q.multiSelect,
        allowFreeText: q.allowFreeText,
        options: (q.options ?? []).map((o) => ({
          value: o.value,
          label: o.label,
          description: o.description ?? null,
        })),
      })),
    };
  // Provider and plugin interactions use their native UI embedded in the channel.
  return {
    ...base,
    kind: "other",
    title: payload.title || "is waiting for your input",
    detail: payload.kind === "plugin" ? payload.presentation?.detail ?? null : null,
    decisions: [],
    questions: [],
  };
}

const key = (approvals: ChannelApproval[]) =>
  approvals
    .map((a) => `${a.roomId}:${a.threadId}:${a.id}`)
    .sort()
    .join("|");

/**
 * Pending requests from bot work threads, forwarded to the channel that started
 * them. Polling fills a cache so channel reads stay synchronous.
 */
export class ChannelApprovals {
  private byRoom = new Map<string, ChannelApproval[]>();
  private retryAt = 0;
  constructor(
    private bb: BbPluginApi,
    private store: Store,
    private changed: () => void,
  ) {}

  list(roomId: string): ChannelApproval[] {
    return this.byRoom.get(roomId) ?? [];
  }
  counts(): Record<string, number> {
    return Object.fromEntries(
      [...this.byRoom].map(([roomId, approvals]) => [roomId, approvals.length]),
    );
  }

  private eligible(job: Job) {
    if (!job.threadId || !job.roomId) return null;
    const room = this.store.findRoom(job.roomId);
    if (!room || room.archived || !room.memberIds.includes(job.botId))
      return null;
    const conversation = this.store.byThread(job.threadId);
    if (!conversation || conversation.botId !== job.botId) return null;
    return { threadId: job.threadId, roomId: job.roomId };
  }

  async tick(signal?: AbortSignal) {
    if (Date.now() < this.retryAt || signal?.aborted) return;
    const next = new Map<string, ChannelApproval[]>();
    const seen = new Set<string>();
    try {
      for (const job of this.store.executingRoomJobs()) {
        if (signal?.aborted) return;
        const target = this.eligible(job);
        // One session runs per thread, so the first job owns its requests.
        if (!target || seen.has(target.threadId)) continue;
        seen.add(target.threadId);
        const pending = await this.bb.sdk.threads.interactions
          .list({ threadId: target.threadId, signal })
          .catch((cause) => {
            if (missingThread(cause)) return [];
            throw cause;
          });
        for (const interaction of pending) {
          if (interaction.status !== "pending") continue;
          const view = approvalView(interaction, {
            roomId: target.roomId,
            botId: job.botId,
            jobId: job.id,
          });
          next.set(target.roomId, [...(next.get(target.roomId) ?? []), view]);
        }
      }
    } catch (cause) {
      this.retryAt = Date.now() + 30_000;
      this.bb.log.debug(`Channel approvals waiting: ${String(cause)}`);
      return;
    }
    const before = key([...this.byRoom.values()].flat());
    this.byRoom = next;
    if (key([...next.values()].flat()) !== before) this.changed();
  }

}
