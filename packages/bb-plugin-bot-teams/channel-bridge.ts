import {
  type ClientTurnRequestId,
  type PromptInput,
  type ThreadDelta,
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  createBridgeIo,
  decodeToolCallResponsePayload,
  experimental_defineProviderBridge,
  runBridgeRequest,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  threadStopParamsSchema,
  turnStartParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { z } from "zod";
import {
  channelDeliverPrefix,
  channelDeliverySchema,
  channelModels,
  isChannelMode,
  channelPostTool,
  channelStartPrefix,
  deliveryMarkdown,
} from "./channel-provider";

/**
 * The channel provider's bridge. It runs no model: a user's message becomes a
 * `bots_channel_thread_post` call that Studio Teams routes to the channel's bots,
 * and bot replies come back later as hidden deliveries it shows as assistant
 * messages.
 */
interface Session {
  threadId: string;
  providerThreadId: string;
  turns: number;
}

type JsonRpcId = string | number;

const sessions = new Map<string, Session>();
const pendingPosts = new Map<string, { session: Session; callId: string }>();
const io = createBridgeIo<{ jsonrpc: "2.0" } & Record<string, unknown>>();
let requestCounter = 0;

function emit(threadId: string, deltas: ThreadDelta[]) {
  io.send({ jsonrpc: "2.0", method: THREAD_DELTA_NOTIFICATION_METHOD, params: { threadId, deltas } });
}

type TextInput = Extract<PromptInput, { type: "text" }>;

/** Everything the bridge reads, hidden deliveries included. */
function promptText(input: readonly PromptInput[]) {
  return input
    .filter((item): item is TextInput => item.type === "text")
    .map((item) => item.text)
    .join("");
}

/** Markdown for a pill Studio Teams offered: bots, channels, and direct messages. */
export function pillText(itemId: string, label: string) {
  const split = itemId.indexOf(":");
  const provider = itemId.slice(0, split), id = itemId.slice(split + 1);
  const text = label.replace(/[\\[\]]/gu, "\\$&");
  switch (provider) {
    case "bots":
      return `@${id}`;
    case "channels":
      return `[${text}](/plugins/bot-teams/channels/${id})`;
    case "dms":
      return `[${text}](/threads/${id})`;
    default:
      return null;
  }
}

/**
 * The owner's own words, as the channel router expects them: a bot pill
 * becomes `@handle` again, channel and direct-message pills become links the
 * bots can follow, and mention context BB adds for the agent is left out.
 */
function ownerText(input: readonly PromptInput[]) {
  return input
    .filter((item): item is TextInput => item.type === "text" && item.visibility !== "agent-only")
    .map((item) => {
      let text = item.text;
      for (const mention of [...item.mentions].sort((a, b) => b.start - a.start)) {
        const resource = mention.resource;
        if (resource.kind !== "plugin" || resource.pluginId !== "bot-teams") continue;
        const replacement = pillText(resource.itemId, resource.label);
        if (replacement) text = `${text.slice(0, mention.start)}${replacement}${text.slice(mention.end)}`;
      }
      return text;
    })
    .join("");
}

/** BB names uploads `<name>-<timestamp>-<suffix>.<ext>`; show the name the owner picked. */
const uploadName = (path: string) =>
  basename(path).replace(/-\d{13}-[a-z0-9]{6}(\.[^.]+)?$/u, "$1");

function promptAttachments(input: readonly PromptInput[]) {
  return input.flatMap((item) =>
    item.type === "localImage"
      ? [{ path: item.path, name: uploadName(item.path), image: true }]
      : item.type === "localFile"
        ? [{
            path: item.path,
            name: item.name ?? uploadName(item.path),
            ...(item.mimeType ? { mimeType: item.mimeType } : {}),
            ...(item.sizeBytes !== undefined ? { sizeBytes: item.sizeBytes } : {}),
            image: false,
          }]
        : [],
  );
}

function accepted(clientRequestId: ClientTurnRequestId | undefined): ThreadDelta[] {
  return clientRequestId === undefined ? [] : [{ kind: "input.accepted", clientRequestId }];
}

function deliver(session: Session, text: string, clientRequestId?: ClientTurnRequestId) {
  const parsed = channelDeliverySchema.safeParse(JSON.parse(text));
  const body = parsed.success ? deliveryMarkdown(parsed.data) : "_A channel message could not be shown._";
  session.turns += 1;
  const key = { providerItemId: `message-${session.providerThreadId}-${session.turns}` };
  emit(session.threadId, [
    ...accepted(clientRequestId),
    { kind: "turn.open" },
    { kind: "item.open", key, item: { type: "agentMessage", text: "" } },
    { kind: "item.textDelta", key, channel: "agentMessage", text: body },
    { kind: "item.textClose", key, channel: "agentMessage", text: body },
    { kind: "turn.boundary", status: "completed" },
  ]);
}

/** Handing a message to the router is bookkeeping: the row stays collapsed. */
const postPresentation = {
  label: { pending: "Sending to channel", completed: "Sent to channel" },
  icon: { glyph: "Send" },
  suppress: true,
};

/** A user's message: hand it to Studio Teams, which routes it like any channel message. */
/** The composer's picker: its model is the chat mode, its reasoning level the bot permissions. */
interface Selection {
  model?: string;
  reasoningLevel?: string;
}

function post(
  session: Session,
  input: readonly PromptInput[],
  selection: Selection,
  clientRequestId?: ClientTurnRequestId,
) {
  session.turns += 1;
  const callId = `post-${session.providerThreadId}-${session.turns}`;
  const args = {
    text: ownerText(input),
    attachments: promptAttachments(input),
    ...(selection.model && isChannelMode(selection.model) ? { mode: selection.model } : {}),
    ...(selection.reasoningLevel ? { permissionLevel: selection.reasoningLevel } : {}),
  };
  emit(session.threadId, [
    ...accepted(clientRequestId),
    { kind: "turn.open" },
    {
      kind: "item.open",
      key: { providerItemId: callId },
      item: { type: "tool", tool: channelPostTool, server: "bb", args },
      presentation: postPresentation,
    },
  ]);
  requestCounter += 1;
  const requestId = `bot-teams-channel-${requestCounter}`;
  pendingPosts.set(requestId, { session, callId });
  io.send({
    jsonrpc: "2.0",
    id: requestId,
    method: BRIDGE_INBOUND_REQUEST_METHODS.toolCall,
    params: {
      providerThreadId: session.providerThreadId,
      threadId: session.threadId,
      turnId: null,
      callId,
      tool: channelPostTool,
      arguments: args,
      providerNativeIds: true,
    },
  });
}

function runTurn(
  session: Session,
  input: readonly PromptInput[],
  selection: Selection,
  clientRequestId?: ClientTurnRequestId,
) {
  const text = promptText(input);
  if (text.startsWith(channelDeliverPrefix))
    return deliver(session, text.slice(channelDeliverPrefix.length), clientRequestId);
  if (text.startsWith(channelStartPrefix))
    return emit(session.threadId, [
      ...accepted(clientRequestId),
      { kind: "turn.boundary", status: "completed", claimIfIdle: true },
    ]);
  post(session, input, selection, clientRequestId);
}

function openSession(threadId: string, providerThreadId: string) {
  const session: Session = { threadId, providerThreadId, turns: 0 };
  sessions.set(threadId, session);
  io.send({
    jsonrpc: "2.0",
    method: BRIDGE_NOTIFICATION_METHODS.threadIdentity,
    params: { threadId, providerThreadId },
  });
  emit(threadId, [{ kind: "session.reset" }]);
  return session;
}

function invalidParams(id: JsonRpcId, method: string, issues: unknown) {
  io.sendError(id, BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, `Invalid params for ${method}`, { issues });
}

const handlers: Record<string, (id: JsonRpcId, params: unknown) => void> = {
  [BRIDGE_REQUEST_METHODS.initialize]: (id) =>
    io.sendResult(id, {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: {
        grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
        sessionRestore: true,
        threadArchive: false,
        threadRename: false,
        threadGoalClear: false,
        fork: "none",
        approvalEnforcedBy: "runtime",
        steerMode: "queue",
      },
    }),
  [BRIDGE_REQUEST_METHODS.modelList]: (id) =>
    io.sendResult(id, {
      models: channelModels.map((model) => ({ ...model, model: model.id })),
      selectedOnlyModels: [],
    }),
  // "Not installed" keeps the provider out of the model picker; Studio Teams creates channel threads by ID.
  [BRIDGE_REQUEST_METHODS.providerHealth]: (id) =>
    io.sendResult(id, {
      supported: true,
      health: {
        status: "not_installed",
        statusMessage: "Channel threads are created from the Channels sidebar.",
        accountEmail: null,
        planLabel: null,
        installedVersion: null,
        minimumSupportedVersion: null,
        canInstall: false,
        canUpdate: false,
        loginCommand: null,
      },
    }),
  [BRIDGE_REQUEST_METHODS.threadStart]: (id, params) => {
    const parsed = threadStartParamsSchema.safeParse(params);
    if (!parsed.success) return invalidParams(id, "thread/start", parsed.error.issues);
    const providerThreadId = `channel_${randomUUID()}`;
    const session = openSession(parsed.data.threadId, providerThreadId);
    io.sendResult(id, { providerThreadId, sessionRestorable: true });
    if (parsed.data.input?.length) runTurn(session, parsed.data.input, parsed.data.options);
  },
  [BRIDGE_REQUEST_METHODS.threadResume]: (id, params) => {
    const parsed = threadResumeParamsSchema.safeParse(params);
    if (!parsed.success) return invalidParams(id, "thread/resume", parsed.error.issues);
    openSession(parsed.data.threadId, parsed.data.providerThreadId);
    io.sendResult(id, { providerThreadId: parsed.data.providerThreadId, sessionRestorable: true });
  },
  [BRIDGE_REQUEST_METHODS.turnStart]: (id, params) => {
    const parsed = turnStartParamsSchema.safeParse(params);
    if (!parsed.success) return invalidParams(id, "turn/start", parsed.error.issues);
    const session = sessions.get(parsed.data.threadId);
    if (!session)
      return io.sendError(id, BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, `No session for thread ${parsed.data.threadId}`);
    io.sendResult(id, {});
    runTurn(session, parsed.data.input, parsed.data.options, parsed.data.clientRequestId);
  },
  [BRIDGE_REQUEST_METHODS.turnSteer]: (id) =>
    io.sendError(id, BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN, "Channel messages queue; they cannot steer."),
  [BRIDGE_REQUEST_METHODS.threadStop]: (id, params) => {
    const parsed = threadStopParamsSchema.safeParse(params);
    if (!parsed.success) return invalidParams(id, "thread/stop", parsed.error.issues);
    sessions.delete(parsed.data.threadId);
    io.sendResult(id, {});
  },
};

const responseSchema = z
  .object({ id: z.string(), result: z.unknown().optional(), error: z.unknown().optional() })
  .passthrough();

function handleResponse(message: unknown) {
  const parsed = responseSchema.safeParse(message);
  if (!parsed.success) return;
  const pending = pendingPosts.get(parsed.data.id);
  if (!pending) return;
  pendingPosts.delete(parsed.data.id);
  const { session, callId } = pending;
  if (!sessions.has(session.threadId)) return;
  const error = z.object({ message: z.string() }).safeParse(parsed.data.error);
  const decoded =
    parsed.data.error === undefined
      ? decodeToolCallResponsePayload(parsed.data.result)
      : { content: error.success ? error.data.message : "The channel did not accept this message.", isError: true };
  emit(session.threadId, [
    {
      kind: "item.close",
      key: { providerItemId: callId },
      status: decoded.isError ? "failed" : "completed",
      item: {
        type: "tool",
        tool: channelPostTool,
        server: "bb",
        args: {},
        ...(decoded.isError ? { error: decoded.content } : { result: decoded.content }),
      },
      presentation: postPresentation,
    },
    decoded.isError
      ? { kind: "turn.boundary", status: "failed", error: { message: decoded.content } }
      : { kind: "turn.boundary", status: "completed" },
  ]);
}

export function handleLine(line: string) {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof message !== "object" || message === null) return;
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
  if (typeof method !== "string") return handleResponse(message);
  if (typeof id !== "string" && typeof id !== "number") return;
  const handler = handlers[method];
  if (!handler)
    return io.sendError(id, BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
  runBridgeRequest({
    request: { id, method, params },
    sendError: io.sendError,
    handleRequest: async (request) => handler(request.id, request.params),
  });
}

export const experimental_providerBridge = experimental_defineProviderBridge({ handleLine });
