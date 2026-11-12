// Hands-free voice's RPCs and the reply relay (live.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { voiceLiveContract } from "./contract";
import type { VoiceLive } from "./live";

export function registerVoiceLive(bb: BbPluginApi, live: VoiceLive): void {
  bb.rpc.register(voiceLiveContract, {
    "voiceLive.state": () => live.state(),
    "voiceLive.configure": (input) => live.configure(input),
    "voiceLive.start": (input) => live.start(input),
    "voiceLive.tool": ({ sessionId, name, args, events }) => live.toolReply(sessionId, name, args, events),
    "voiceLive.event": ({ sessionId, events }) => live.record(sessionId, events),
    "voiceLive.poll": ({ sessionId }) => live.poll(sessionId),
    "voiceLive.end": ({ sessionId, events }) => live.end(sessionId, events),
  });
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    void live.idle(thread.id, lastAssistantText ?? null).catch((error) => bb.log.warn(`Hands-free voice couldn't relay ${thread.id}'s reply: ${String(error)}`));
  });
  // Sessions whose hang-up never came (the app killed, the network gone) end on their own: now, then every minute.
  const reap = () => void live.reap().catch((error) => bb.log.warn(`Hands-free voice couldn't end stale sessions: ${String(error)}`));
  reap();
  const reaper = setInterval(reap, 60_000);
  bb.onDispose(() => clearInterval(reaper));
}
