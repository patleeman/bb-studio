import { z } from "zod";
import { rpcContract as botContract } from "./contract";
import { viewContract, threadViewSchema } from "./view-contract";

export const rpcContract = {
  ...viewContract,
  list: { input: z.null(), output: botContract.list.output.extend({ views: z.array(threadViewSchema) }) },
  spaceConversations: botContract.spaceConversations,
  createBotSetupThread: botContract.createBotSetupThread,
  create: botContract.create,
  resolveBotCreateRequest: botContract.resolveBotCreateRequest,
  update: botContract.update,
  swapModel: botContract.swapModel,
  retire: botContract.retire,
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
  usage: { ...botContract.usage, input: botContract.usage.input.extend({ kind: z.literal("bot") }) },
  saveLimits: { ...botContract.saveLimits, input: botContract.saveLimits.input.extend({ kind: z.literal("bot") }) },
};
