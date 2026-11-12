// The window's one meeting and whether its stage is minimized. No SDK or
// React imports, so menus and commands can start a meeting without pulling
// in the stage (MeetingStage.tsx reads this store).
import type { Addressing } from "../shared";
import { MeetingController, meetingServer } from "./controller";

export type Rpc = { call(method: string, input: unknown): Promise<unknown> };
export type MeetingState = { meeting: MeetingController | null; minimized: boolean; starting: string | null };

let state: MeetingState = { meeting: null, minimized: false, starting: null };
const listeners = new Set<() => void>();
/** The stage keeps the window's RPC client here, so the command palette and New menu can start a meeting. */
let windowRpc: Rpc | null = null;

export const meetingState = (): MeetingState => state;
export function setMeetingState(patch: Partial<MeetingState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
export function subscribeMeeting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function setWindowRpc(rpc: Rpc): void {
  windowRpc = rpc;
}

/** Starts a meeting (or brings back the running one's stage). */
export async function startMeeting(rpc: Rpc | null = windowRpc): Promise<void> {
  if (state.meeting?.session.machine.isLive) return setMeetingState({ minimized: false });
  if (!rpc) return;
  setMeetingState({ starting: "Getting ready…", minimized: false });
  let name = "Iris";
  let mode: Addressing = "name";
  try {
    const ready = (await rpc.call("meeting.state", {})) as { name: string; addressing: Addressing };
    name = ready.name;
    mode = ready.addressing;
  } catch { /* The session's own start reports the problem. */ }
  state.meeting?.dispose();
  const meeting = new MeetingController(meetingServer(rpc), name, mode);
  // Staged runs read it to drive and measure the stage.
  (globalThis as { __studioMeeting?: MeetingController }).__studioMeeting = meeting;
  setMeetingState({ meeting, starting: null });
  meeting.start();
}
