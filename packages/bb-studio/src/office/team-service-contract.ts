import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { officeTeamContract, talkConversationSchema } from "./contract";
export const officeTeamServiceContract = defineRpcContract({
  office_dm: officeTeamContract.talk_dm,
  office_direct: { input: z.object({ botId: z.string() }), output: z.object({ conversationId: z.string().nullable(), threadId: z.string().nullable() }) },
  office_talk: { input: z.object({}), output: z.object({ conversations: z.array(talkConversationSchema.extend({ projectId: z.string() })) }) },
});
