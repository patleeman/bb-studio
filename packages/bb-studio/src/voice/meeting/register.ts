// Meeting mode's RPCs and the lookup answers (meeting.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { meetingContract } from "./contract";
import type { MeetingLive } from "./meeting";

export function registerMeeting(bb: BbPluginApi, meeting: MeetingLive): void {
  bb.rpc.register(meetingContract, {
    "meeting.state": () => meeting.state(),
    "meeting.start": (input) => meeting.start(input) as never,
    "meeting.tool": async ({ sessionId, name, args, events }) => ({ output: await meeting.tool(sessionId, name, args, events) }),
    "meeting.event": ({ sessionId, events }) => meeting.record(sessionId, events),
    "meeting.poll": ({ sessionId }) => meeting.poll(sessionId),
    "meeting.view": ({ sessionId }) => meeting.view(sessionId),
    "meeting.end": ({ sessionId, events }) => meeting.end(sessionId, events),
  });
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    try { meeting.idle(thread.id, lastAssistantText ?? null); } catch (error) { bb.log.warn(`The meeting agent couldn't pick up ${thread.id}'s answer: ${String(error)}`); }
  });
}
