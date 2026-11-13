import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { existsSync } from "node:fs";
import type { BotThreadRecord, ForkedFrom } from "./bot-threads";
import { PERSONAL_PROJECT_ID } from "./project-lead";
import type { SideKind, SideThreads, TimelineRow } from "./bot-side-threads";
import type { ReasoningLevel } from "./kit/reasoning";
import type { ThreadSeeds } from "./thread-seeds";

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
  | { type: "host"; hostId: string; workspace: { type: "unmanaged"; path: string | null } | { type: "personal" } | { type: "managed-worktree"; baseBranch: { kind: "default" } } }
  | { type: "project-default" };

export interface Placement {
  projectId?: string;
  environment: SeedEnvironment | null;
}

const GIT_WORKTREE = "git-worktree";

export interface MessageThreadDeps {
  sdk: Sdk;
  sides: Pick<SideThreads, "newest" | "record" | "message" | "transcript">;
  source(threadId: string): Promise<Pick<BotThreadRecord, "botId" | "kind"> | null>;
  title(threadId: string): Promise<string>;
  recordFork(threadId: string, botId: string, from: ForkedFrom): void;
  defaultModel(botId: string): { providerId: string; model: string; reasoning: ReasoningLevel | null } | null;
  changed(threadId: string): void;
  log(message: string): void;
  seeds?: Pick<ThreadSeeds, "ready" | "put">;
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
    const place = await this.placement(ref.threadId, source.kind !== "worker");
    const title = `${await this.deps.title(ref.threadId)} · ${kind === "fork" ? "fork" : "thread"}`;
    const fork = (place.projectId
      ? await this.fromTranscript(ref.threadId, sourceSeqEnd, title, place)
      : await this.deps.sdk.threads.fork({ sourceThreadId: ref.threadId, sourceSeqEnd, visibility: "visible", title, ...(place.environment ? { environment: place.environment } : {}) } as never)
        .catch(async (error: unknown) => {
          this.deps.log(`Forking at ${ref.messageId} failed, starting from the transcript: ${error instanceof Error ? error.message : String(error)}`);
          return await this.fromTranscript(ref.threadId, sourceSeqEnd, title, place);
        })) as { id: string; projectId?: string | null; providerId?: string | null };
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

  private async fromTranscript(threadId: string, upToSeq: number, title: string, place: Placement): Promise<{ id: string; projectId?: string | null; providerId?: string | null }> {
    const { sdk, seeds } = this.deps;
    if (!seeds?.ready()) {
      this.deps.log("This BB can't give an idle thread the transcript as context, so no thread was started.");
      throw new Error("Couldn't start a thread from that message.");
    }
    const parent = await sdk.threads.get({ threadId }) as { projectId: string; providerId?: string | null; environmentId?: string | null; model?: string | null };
    const where = place.environment ?? (parent.environmentId ? { type: "reuse", environmentId: parent.environmentId } : { type: "project-default" });
    const seed = transcriptSeed(await this.deps.sides.transcript(threadId, upToSeq), SEED_CONTEXT_MAX);
    try {
      const made = await sdk.threads.spawn({
        projectId: place.projectId ?? parent.projectId, ...(parent.providerId ? { providerId: parent.providerId } : {}), ...(parent.model ? { model: parent.model } : {}),
        title, visibility: "visible", environment: where, input: [],
      } as never) as { id: string; projectId?: string | null; providerId?: string | null };
      seeds.put(made.id, seed);
      return made;
    } catch (error) {
      this.deps.log(`Starting a thread from the transcript failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error("Couldn't start a thread from that message.");
    }
  }

  async placement(threadId: string, chat: boolean): Promise<Placement> {
    const { sdk } = this.deps;
    const thread = await settle(() => sdk.threads.get({ threadId }), null) as { projectId?: string; environmentId?: string | null } | null;
    if (!thread?.projectId) return { environment: null };
    const environment = thread.environmentId
      ? await settle(() => sdk.environments.get({ environmentId: thread.environmentId! }), null) as { hostId?: string | null; path?: string | null; status?: string; environmentProviderId?: string | null } | null
      : null;
    const hosts = await settle(() => sdk.hosts.list(), []) as { id: string; status?: string }[];
    const connected = (hostId: string | null | undefined) => !!hostId && hosts.find((host) => host.id === hostId)?.status === "connected";
    if (environment && connected(environment.hostId) && (environment.status ?? "ready") === "ready") return { environment: null };
    const hostId = (await settle(() => sdk.system.config(), null))?.primaryHostId ?? null;
    if (!hostId || !connected(hostId)) return { environment: null };
    if (environment?.path) {
      const twins = await settle(() => sdk.environments.list({ projectId: thread.projectId, hostId, path: environment.path } as never), []) as { id: string; status?: string }[];
      const twin = twins.find((each) => each.status === "ready");
      if (twin) return { environment: { type: "reuse", environmentId: twin.id } };
    }
    const personal: SeedEnvironment = { type: "host", hostId, workspace: { type: "personal" } };
    const project = await settle(() => sdk.projects.get({ projectId: thread.projectId } as never), null) as { kind?: string } | null;
    if (project?.kind === "personal") return { environment: personal };
    if (chat) return { projectId: PERSONAL_PROJECT_ID, environment: personal };
    if (environment?.environmentProviderId === GIT_WORKTREE) return { environment: { type: "host", hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } } };
    if (environment?.path && existsSync(environment.path)) return { environment: { type: "host", hostId, workspace: { type: "unmanaged", path: environment.path } } };
    return { environment: { type: "host", hostId, workspace: { type: "unmanaged", path: null } } };
  }
}

async function settle<T, F>(run: () => Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

const SEED_MAX = 60_000;
export const SEED_CONTEXT_MAX = 6_000;

export function transcriptSeed(rows: readonly TimelineRow[], max = SEED_MAX): string {
  const lines = rows.map((row) => `${row.role === "assistant" ? "Assistant" : "User"}: ${row.text!.trim()}`);
  let text = lines.join("\n\n");
  if (text.length > max) text = `…\n\n${text.slice(text.length - max)}`;
  return `This thread continues an earlier conversation. Here it is, up to the message the user is replying to (the last one):\n\n${text}`;
}
