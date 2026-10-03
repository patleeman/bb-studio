import { officeTeamServiceContract } from "../../office/team-service-contract";
import { z } from "zod";
import { rpcContract as botContract } from "./contract";
import { viewContract, threadViewSchema } from "./view-contract";

/** Public Teams API. Channel execution and transcript APIs are retired. */
export const rpcContract = {
  ...officeTeamServiceContract,
  ...viewContract,
  list: { input: z.null(), output: botContract.list.output.omit({ rooms: true, activeRoomIds: true, roomThreads: true, roomWork: true, attentionCounts: true, approvalCounts: true }).extend({ views: z.array(threadViewSchema) }) },
  spaceConversations: { input: z.null(), output: botContract.spaceConversations.output.omit({ channels: true }) },
  createBotSetupThread: botContract.createBotSetupThread,
  create: { ...botContract.create, input: botContract.create.input.omit({ roomId: true }) },
  resolveBotCreateRequest: botContract.resolveBotCreateRequest,
  update: botContract.update,
  swapModel: botContract.swapModel,
  retire: botContract.retire,
  retryJob: botContract.retryJob,
  cancelJob: botContract.cancelJob,
  profiles: botContract.profiles,
  threadProfile: botContract.threadProfile,
  threadBots: botContract.threadBots,
  setThreadProfile: botContract.setThreadProfile,
  pendingThreadProfile: botContract.pendingThreadProfile,
  profileThreads: botContract.profileThreads,
  documentHistory: botContract.documentHistory,
  get: botContract.get,
  document: botContract.document,
  saveDocument: botContract.saveDocument,
  wake: botContract.wake,
  conversation: botContract.conversation,
  newConversation: botContract.newConversation,
  handoffSource: botContract.handoffSource,
  usage: { ...botContract.usage, input: botContract.usage.input.extend({ kind: z.literal("bot") }) },
  saveLimits: { ...botContract.saveLimits, input: botContract.saveLimits.input.extend({ kind: z.literal("bot") }) },
};
