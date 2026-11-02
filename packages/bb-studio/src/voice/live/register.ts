// Hands-free voice's RPCs and the reply relay (live.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { voiceLiveContract } from "./contract";
import type { VoiceLive } from "./live";

export function registerVoiceLive(bb: BbPluginApi, live: VoiceLive): void {
  bb.rpc.register(voiceLiveContract, {
    "voiceLive.state": () => live.state(),
    "voiceLive.configure": (input) => live.configure(input),
    "voiceLive.start": (input) => live.start(input),
    "voiceLive.tool": async ({ sessionId, name, args, events }) => ({ output: await live.tool(sessionId, name, args, events) }),
    "voiceLive.event": ({ sessionId, events }) => live.record(sessionId, events),
    "voiceLive.poll": ({ sessionId }) => live.poll(sessionId),
    "voiceLive.end": ({ sessionId, events }) => live.end(sessionId, events),
  });
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    void live.idle(thread.id, lastAssistantText ?? null).catch((error) => bb.log.warn(`Hands-free voice couldn't relay ${thread.id}'s reply: ${String(error)}`));
  });
}
