import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { existsSync } from "node:fs";
import type { BotThreadRecord, ForkedFrom } from "./bot-threads";
import type { SideKind, SideThreads, TimelineRow } from "./bot-side-threads";
import type { ReasoningLevel } from "./kit/reasoning";

type Sdk = BbPluginApi["sdk"];

export interface MessageRef {
  threadId: string;
  messageId: string;
  turnId?: string | null;
  sourceSeqEnd?: number | null;
}

export interface MessageThread {
  threadId: string;
  projectId: string | null;
  created: boolean;
}

export type SeedEnvironment =
  | { type: "reuse"; environmentId: string }
  | { type: "host"; hostId: string; workspace: { type: "unmanaged"; path: string } | { type: "personal" } }
  | { type: "project-default" };

export interface MessageThreadDeps {
  sdk: Sdk;
  sides: Pick<SideThreads, "newest" | "record" | "message" | "transcript">;
  source(threadId: string): Promise<Pick<BotThreadRecord, "botId"> | null>;
  title(threadId: string): Promise<string>;
  recordFork(threadId: string, botId: string, from: ForkedFrom): void;
  defaultModel(botId: string): { providerId: string; model: string; reasoning: ReasoningLevel | null } | null;
  changed(threadId: string): void;
  log(message: string): void;
}

export class MessageThreads {
  private readonly opening = new Map<string, Promise<MessageThread>>();

  constructor(private readonly deps: MessageThreadDeps) {}

  reply(ref: MessageRef): Promise<MessageThread> {
    const key = `${ref.threadId}\n${ref.messageId}`;
    const running = this.opening.get(key);
    if (running) return running;
    const opened = this.reuseOrCreate(ref).finally(() => this.opening.delete(key));
    this.opening.set(key, opened);
    return opened;
  }

  fork(ref: MessageRef): Promise<MessageThread> {
    return this.create(ref, "fork");
  }

  private async reuseOrCreate(ref: MessageRef): Promise<MessageThread> {
    const existing = await this.deps.sides.newest(ref.threadId, ref.messageId);
    if (existing) {
      const thread = await this.deps.sdk.threads.get({ threadId: existing }).catch(() => null) as { projectId?: string | null } | null;
      return { threadId: existing, projectId: thread?.projectId ?? null, created: false };
    }
    return await this.create(ref, "reply");
  }

  private async create(ref: MessageRef, kind: SideKind): Promise<MessageThread> {
    const source = await this.deps.source(ref.threadId);
    if (!source) throw new Error("That thread isn't one of a Bot's conversations.");
    const sourceSeqEnd = ref.sourceSeqEnd ?? (await this.deps.sides.message(ref.threadId, ref.messageId))?.sourceSeqEnd;
    if (sourceSeqEnd === undefined || sourceSeqEnd === null) throw new Error("Couldn't find that message in the conversation.");
    const environment = await this.seedEnvironment(ref.threadId);
    const title = `${await this.deps.title(ref.threadId)} · ${kind === "fork" ? "fork" : "thread"}`;
    const fork = await this.deps.sdk.threads.fork({ sourceThreadId: ref.threadId, sourceSeqEnd, visibility: "visible", title, ...(environment ? { environment } : {}) } as never)
      .catch(async (error: unknown) => {
        this.deps.log(`Forking at ${ref.messageId} failed, starting from the transcript: ${error instanceof Error ? error.message : String(error)}`);
        return await this.fromTranscript(ref.threadId, sourceSeqEnd, title, environment);
      }) as { id: string; projectId?: string | null; providerId?: string | null };
    this.deps.recordFork(fork.id, source.botId, { threadId: ref.threadId, messageId: ref.messageId, turnId: ref.turnId ?? null });
    this.deps.sides.record(fork.id, source.botId, ref.threadId, ref.messageId, Date.now(), kind);
    const preset = this.deps.defaultModel(source.botId);
    const providerId = fork.providerId ?? (await this.deps.sdk.threads.get({ threadId: fork.id }).catch(() => null))?.providerId ?? null;
    if (preset && providerId === preset.providerId) {
      await this.deps.sdk.threads.update({ threadId: fork.id, model: preset.model, ...(preset.reasoning ? { reasoningLevel: preset.reasoning } : {}) } as never)
        .catch((error: unknown) => this.deps.log(`Couldn't start the fork on ${preset.model}: ${error instanceof Error ? error.message : String(error)}`));
    }
    this.deps.changed(fork.id);
    return { threadId: fork.id, projectId: fork.projectId ?? null, created: true };
  }

  private async fromTranscript(threadId: string, upToSeq: number, title: string, environment: SeedEnvironment | null): Promise<{ id: string; projectId?: string | null; providerId?: string | null }> {
    const { sdk } = this.deps;
    const parent = await sdk.threads.get({ threadId }) as { projectId: string; providerId?: string | null; environmentId?: string | null; model?: string | null };
    const where = environment ?? (parent.environmentId ? { type: "reuse", environmentId: parent.environmentId } : { type: "project-default" });
    const seed = transcriptSeed(await this.deps.sides.transcript(threadId, upToSeq));
    try {
      return await sdk.threads.spawn({
        projectId: parent.projectId, ...(parent.providerId ? { providerId: parent.providerId } : {}), ...(parent.model ? { model: parent.model } : {}),
        title, visibility: "visible", environment: where,
        input: [{ type: "text", text: seed, mentions: [], visibility: "agent-only" }],
        startedOnBehalfOf: { initiator: "agent", senderThreadId: threadId },
      } as never) as { id: string; projectId?: string | null; providerId?: string | null };
    } catch (error) {
      this.deps.log(`Starting a thread from the transcript failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error("Couldn't start a thread from that message.");
    }
  }

  async seedEnvironment(threadId: string): Promise<SeedEnvironment | null> {
    const { sdk } = this.deps;
    const thread = await sdk.threads.get({ threadId }).catch(() => null) as { projectId?: string; environmentId?: string | null } | null;
    if (!thread?.environmentId || !thread.projectId) return null;
    const environment = await sdk.environments.get({ environmentId: thread.environmentId }).catch(() => null) as { hostId?: string | null; path?: string | null; environmentProviderId?: string | null } | null;
    if (!environment?.hostId) return null;
    const hosts = await sdk.hosts.list().catch(() => []) as { id: string; status?: string }[];
    if (hosts.find((host) => host.id === environment.hostId)?.status === "connected") return null;
    const hostId = (await sdk.system.config().catch(() => null))?.primaryHostId ?? null;
    if (!hostId || hostId === environment.hostId) return null;
    if (environment.path) {
      const twins = await sdk.environments.list({ projectId: thread.projectId, hostId, path: environment.path } as never).catch(() => []) as { id: string; status?: string }[];
      const twin = twins.find((each) => each.status === "ready");
      if (twin) return { type: "reuse", environmentId: twin.id };
    }
    const project = await sdk.projects.get({ projectId: thread.projectId } as never).catch(() => null) as { kind?: string } | null;
    if (project?.kind === "personal") return { type: "host", hostId, workspace: { type: "personal" } };
    if (!environment.environmentProviderId && environment.path && existsSync(environment.path)) return { type: "host", hostId, workspace: { type: "unmanaged", path: environment.path } };
    return { type: "project-default" };
  }
}

const SEED_MAX = 60_000;

export function transcriptSeed(rows: readonly TimelineRow[]): string {
  const lines = rows.map((row) => `${row.role === "assistant" ? "Assistant" : "User"}: ${row.text!.trim()}`);
  let text = lines.join("\n\n");
  if (text.length > SEED_MAX) text = `…\n\n${text.slice(text.length - SEED_MAX)}`;
  return `This thread continues an earlier conversation. Here it is, up to the message the user is replying to (the last one):\n\n${text}`;
}
