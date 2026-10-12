import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createBridgeIo, experimental_defineProviderBridge, initializeParamsSchema,
  threadStartParamsSchema, threadResumeParamsSchema, turnStartParamsSchema,
  threadStopParamsSchema, threadDiscardParamsSchema,
  PROVIDER_BRIDGE_PROTOCOL_VERSION, THREAD_DELTA_GRAMMAR_V3,
  type ThreadDelta, type AvailableModel,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { resolveToken } from "./credentials.js";
import { AgentConnectionError, connectionSchema, type Connection } from "./hermes-client.js";

/**
 * Grok through xAI's OpenAI-compatible API. It is a chat provider: Grok
 * streams text, and BB's local tools are not offered to it (the bridge would
 * have to run BB's MCP tool server itself). The conversation is kept on this
 * host, one JSON file per BB thread, because the chat API is stateless.
 */
type Message = { role: "system" | "user" | "assistant"; content: string };

export class GrokClient {
  readonly connection: Connection;
  private readonly token: string;
  /** A stream that sends nothing for this long is given up on, even with a caller's signal. */
  static idleMs = 90_000;
  constructor(connection: Connection, env: NodeJS.ProcessEnv = process.env) {
    this.connection = connectionSchema.parse(connection);
    this.token = resolveToken(connection.tokenEnv, connection.tokenEnvFile, env);
  }
  private async request(path: string, body?: unknown, signal?: AbortSignal, timedOut?: () => boolean): Promise<Response> {
    if (!this.connection.enabled) throw new AgentConnectionError("Grok is disabled in Studio Agents settings.");
    if (!this.token) throw new AgentConnectionError(`Grok API key is missing. Set ${this.connection.tokenEnv} on the BB host.`);
    let response: Response;
    try {
      response = await fetch(`${this.connection.baseUrl.replace(/\/$/, "")}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ?? AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch {
      throw new AgentConnectionError(timedOut?.() ? "Grok stopped responding." : signal?.aborted ? "Grok request was cancelled." : "Grok is unreachable. Check its API URL.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AgentConnectionError(response.status === 401 || response.status === 403
        ? "xAI rejected the API key. Check the configured key." : `xAI API returned HTTP ${response.status}.`, response.status);
    }
    return response;
  }
  async models(): Promise<unknown> {
    const response = await this.request("/models");
    try { return await response.json(); } catch { throw new AgentConnectionError("xAI returned invalid JSON."); }
  }
  /** Streams text deltas of one chat completion. */
  async *chat(model: string, messages: Message[], signal: AbortSignal): AsyncGenerator<string> {
    // The caller's signal (stop) and an inactivity timer, combined: the timer
    // restarts on every chunk, so a long answer is fine but a stalled one ends.
    const abort = new AbortController();
    let idle = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { idle = true; abort.abort(); }, GrokClient.idleMs); };
    const onAbort = () => abort.abort();
    if (signal.aborted) abort.abort(); else signal.addEventListener("abort", onAbort, { once: true });
    arm();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.request("/chat/completions", { model, messages, stream: true }, abort.signal, () => idle);
      if (!response.body) throw new AgentConnectionError("xAI returned an empty stream.");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        arm();
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); } catch { throw new AgentConnectionError(idle ? "Grok stopped responding." : "Grok stream was interrupted."); }
        const { value, done } = chunk;
        if (done) return;
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { throw new AgentConnectionError("xAI sent malformed stream JSON."); }
          const text = parsed?.choices?.[0]?.delta?.content;
          if (typeof text === "string" && text) yield text;
        }
        if (buffer.length > 1_048_576) throw new AgentConnectionError("xAI stream line exceeds the size limit.");
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      await reader?.cancel().catch(() => {});
    }
  }
}

export function grokModels(value: unknown): AvailableModel[] {
  const parsed = z.object({ data: z.array(z.object({ id: z.string().min(1) }).passthrough()) }).safeParse(value);
  if (!parsed.success) throw new AgentConnectionError("xAI returned an invalid model list.");
  // Image and embedding models are listed too; only chat models fit a thread.
  const chat = parsed.data.data.filter(m => !/image|embed|vision-only/i.test(m.id));
  return chat.map((m, i) => ({ id: m.id, model: m.id, displayName: m.id, description: "xAI model", isDefault: i === 0, defaultReasoningEffort: "none", supportedReasoningEfforts: [{ reasoningEffort: "none", description: "Model default" }] }));
}

export async function grokHealth(connection: Connection) {
  try {
    await new GrokClient(connection).models();
    return { online: true, status: "ready" as const, message: "xAI API is reachable." };
  } catch (error) {
    return { online: false, status: error instanceof AgentConnectionError && [401, 403].includes(error.status ?? 0) ? "unauthenticated" as const : "unknown" as const, message: error instanceof AgentConnectionError ? error.message : "Grok configuration is invalid." };
  }
}

export const HISTORY_LIMITS = { messages: 80, chars: 240_000 };

/**
 * Bounds a thread's history so it isn't resent without end: at most
 * `limits.messages` messages and `limits.chars` characters (a rough token
 * budget). The oldest turns go first; the first message (the user's opening
 * instruction) stays, and what's kept after it starts with a user turn.
 */
export function boundHistory(messages: Message[], limits = HISTORY_LIMITS): Message[] {
  if (messages.length <= 1) return messages;
  const [first, ...rest] = messages as [Message, ...Message[]];
  const size = (list: Message[]) => list.reduce((sum, m) => sum + m.content.length, 0);
  let start = 0;
  while (start < rest.length && (1 + rest.length - start > limits.messages || first.content.length + size(rest.slice(start)) > limits.chars)) start++;
  while (start < rest.length && start > 0 && rest[start]!.role !== "user") start++;
  // The newest turn always goes, even if it alone is over the budget.
  if (start >= rest.length) start = rest.length - 1;
  return start === 0 ? messages : [first, ...rest.slice(start)];
}

/** Histories untouched this long belong to deleted or long-archived threads, and are pruned. */
export const HISTORY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export function grokHistoryStore(dir = join(homedir(), ".config", "bb-external-agents", "grok"), now = Date.now()) {
  const file = (id: string) => join(dir, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  // Cheap: one directory scan when the bridge starts.
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (name.endsWith(".json") && now - statSync(path).mtimeMs > HISTORY_MAX_AGE_MS) rmSync(path, { force: true });
    }
  } catch { /* no history yet */ }
  return {
    read(id: string): Message[] { try { return boundHistory(JSON.parse(readFileSync(file(id), "utf8"))); } catch { return []; } },
    write(id: string, messages: Message[]) { mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileSync(file(id), JSON.stringify(boundHistory(messages)), { mode: 0o600 }); },
  };
}

type Session = { threadId: string; providerThreadId: string; connection: Connection; model?: string; instructions?: string; active?: { id: string; abort: AbortController } };

function prompt(input: readonly { type: string; text?: string }[]): string {
  if (input.some(part => part.type !== "text")) throw new AgentConnectionError("Grok accepts text messages only.");
  return input.map(part => part.text || "").join("\n");
}

export function createGrokBridge(write?: (line: string) => void, store = grokHistoryStore()) {
  const io = createBridgeIo<unknown>({ write });
  const sessions = new Map<string, Session>();
  const send = (method: string, params: unknown) => io.send({ jsonrpc: "2.0", method, params });
  const deltas = (threadId: string, value: ThreadDelta[]) => { if (value.length) send("thread/delta", { threadId, deltas: value }); };
  const current = (threadId: string) => {
    const session = sessions.get(threadId);
    if (!session) throw new AgentConnectionError("Grok session is not open. Resume the BB thread.");
    return session;
  };
  async function catalog(connection: Connection) { return grokModels(await new GrokClient(connection).models()); }

  function run(session: Session, input: string, clientRequestId?: string) {
    if (session.active) throw new AgentConnectionError("Grok is already answering in this thread.");
    const active = { id: `grok-${randomUUID()}`, abort: new AbortController() };
    session.active = active;
    const history = boundHistory([...store.read(session.providerThreadId), { role: "user", content: input }]);
    if (clientRequestId) deltas(session.threadId, [{ kind: "input.accepted", clientRequestId, providerTurnId: active.id }]);
    deltas(session.threadId, [{ kind: "turn.open", providerTurnId: active.id }]);
    const key = { channel: "assistant-0" };
    void (async () => {
      let text = "";
      try {
        const model = session.model || (await catalog(session.connection))[0]?.model;
        if (!model) throw new AgentConnectionError("xAI lists no chat models.");
        const messages: Message[] = [...(session.instructions ? [{ role: "system" as const, content: session.instructions }] : []), ...history];
        for await (const chunk of new GrokClient(session.connection).chat(model, messages, active.abort.signal)) {
          text += chunk;
          deltas(session.threadId, [{ kind: "item.textDelta", key, channel: "agentMessage", text: chunk, providerTurnId: active.id }]);
        }
        if (active.abort.signal.aborted) return;
        store.write(session.providerThreadId, [...history, { role: "assistant", content: text }]);
        deltas(session.threadId, [
          ...(text ? [{ kind: "item.textClose", key, channel: "agentMessage", text, providerTurnId: active.id } as ThreadDelta] : []),
          { kind: "turn.boundary", status: "completed", providerTurnId: active.id },
        ]);
      } catch (error) {
        if (active.abort.signal.aborted) return;
        // Keep the question so the next turn has the context the user saw.
        store.write(session.providerThreadId, history);
        deltas(session.threadId, [{ kind: "provider.error", message: error instanceof AgentConnectionError ? error.message : "Grok bridge failed.", settlesTurn: true, providerTurnId: active.id }]);
      } finally {
        if (session.active === active) session.active = undefined;
      }
    })();
  }
  function stop(session: Session, interrupt: boolean) {
    const active = session.active;
    if (!active) return;
    active.abort.abort();
    session.active = undefined;
    if (interrupt) deltas(session.threadId, [{ kind: "turn.boundary", status: "interrupted", providerTurnId: active.id }]);
  }
  async function handle(raw: Record<string, unknown>) {
    const id = raw.id;
    if ((typeof id !== "number" && typeof id !== "string") || typeof raw.method !== "string") return;
    try {
      const params = raw.params ?? {};
      switch (raw.method) {
        case "initialize":
          initializeParamsSchema.parse(params);
          io.sendResult(id, { protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION, capabilities: { grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3], sessionRestore: true, fork: "none", approvalEnforcedBy: "provider", steerMode: "inject" } });
          break;
        case "model/list": {
          const p = z.object({ providerOptions: connectionSchema }).parse(params);
          io.sendResult(id, { models: await catalog(p.providerOptions), selectedOnlyModels: [] });
          break;
        }
        case "provider/health": {
          const p = z.object({ providerOptions: connectionSchema }).parse(params);
          const result = await grokHealth(p.providerOptions);
          io.sendResult(id, { supported: true, health: { status: result.status, statusMessage: result.message, accountEmail: null, planLabel: null, installedVersion: null, minimumSupportedVersion: null, canInstall: false, canUpdate: false, loginCommand: null } });
          break;
        }
        case "thread/start":
        case "thread/resume": {
          const p = raw.method === "thread/start" ? threadStartParamsSchema.parse(params) : threadResumeParamsSchema.parse(params);
          const previous = sessions.get(p.threadId);
          if (previous) stop(previous, false);
          const connection = connectionSchema.parse(p.options.providerOptions);
          await new GrokClient(connection).models();
          const providerThreadId = typeof p.providerThreadId === "string" ? p.providerThreadId : `bb-grok-${randomUUID()}`;
          const session: Session = { threadId: p.threadId, providerThreadId, connection, model: p.options.model, instructions: p.options.instructions };
          sessions.set(p.threadId, session);
          send("thread/identity", { threadId: p.threadId, providerThreadId, sessionRestorable: true });
          deltas(p.threadId, [{ kind: "session.reset" }]);
          io.sendResult(id, { providerThreadId, sessionRestorable: true });
          if (raw.method === "thread/start") {
            const input = threadStartParamsSchema.parse(params).input;
            if (input?.length) run(session, prompt(input));
          }
          break;
        }
        case "turn/start": {
          const p = turnStartParamsSchema.parse(params);
          const session = current(p.threadId);
          session.model = p.options.model;
          session.instructions = p.options.instructions;
          session.connection = connectionSchema.parse(p.options.providerOptions);
          run(session, prompt(p.input), p.clientRequestId);
          io.sendResult(id, {});
          break;
        }
        case "thread/stop": {
          const p = threadStopParamsSchema.parse(params);
          const session = sessions.get(p.threadId);
          if (session) stop(session, p.intent !== "release");
          io.sendResult(id, {});
          break;
        }
        case "thread/discard": {
          const p = threadDiscardParamsSchema.parse(params);
          const session = sessions.get(p.threadId);
          if (session) stop(session, false);
          sessions.delete(p.threadId);
          io.sendResult(id, {});
          break;
        }
        case "turn/steer":
          throw new AgentConnectionError("Grok can't take a message mid-answer. Wait for it, or stop it and send again.");
        default: io.sendError(id, -32601, `Method not found: ${raw.method}`);
      }
    } catch (error) {
      io.sendError(id, error instanceof z.ZodError ? -32602 : -32000, error instanceof z.ZodError ? `Invalid params for ${raw.method}` : error instanceof AgentConnectionError ? error.message : "Grok bridge request failed.");
    }
  }
  function close() { for (const session of sessions.values()) stop(session, false); sessions.clear(); }
  return experimental_defineProviderBridge({
    handleLine(line) { let raw: unknown; try { raw = JSON.parse(line); } catch { return; } if (raw && typeof raw === "object") void handle(raw as Record<string, unknown>); },
    onClose: close, onSigint: close, onSigterm: close,
  });
}
