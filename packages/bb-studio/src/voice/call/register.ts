// Voice calls' RPCs and the Bot-reply relay (calls.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { voiceCallContract } from "./contract";
import type { VoiceCalls } from "./calls";

export function registerVoiceCalls(bb: BbPluginApi, calls: VoiceCalls): void {
  bb.rpc.register(voiceCallContract, {
    voice_call_state: (input) => calls.state(input),
    voice_call_start: ({ botId }) => calls.start(botId),
    voice_call_tool: async ({ callId, name, args }) => ({ output: await calls.tool(callId, name, args) }),
    voice_call_event: ({ callId, events }) => calls.record(callId, events),
    voice_call_poll: ({ callId }) => calls.poll(callId),
    voice_call_end: ({ callId, events }) => calls.end(callId, events),
    voice_call_get: ({ callId }) => calls.view(callId),
  });
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    void calls.idle(thread.id, lastAssistantText ?? null).catch((error) => bb.log.warn(`Voice calls couldn't relay ${thread.id}'s reply: ${String(error)}`));
  });
}
