// The window's one voice call: the header button starts it, the call bar
// (an app overlay, so it stays while you move around) shows and ends it.
import { useSyncExternalStore } from "react";
import type { voiceCallContract } from "../contract";
import { CallSession, type CallServer } from "./session";
import { connectWebRtc, type RealtimeTransport } from "./transport";

type Rpc = { call<M extends keyof typeof voiceCallContract>(method: M, input: unknown): Promise<unknown> };

export interface ActiveCall {
  callId: string;
  botName: string;
  session: CallSession;
  transport: RealtimeTransport;
}

type State = { call: ActiveCall | null; starting: boolean; error: string | null };

/**
 * Staging only (scripts/capture): a transport to use instead of WebRTC, and
 * a call the capture seeded, so no OpenAI call is made.
 */
export type CallFixture = { callId: string; botName: string; transport: RealtimeTransport };
const fixture = () => (globalThis as { __studioVoiceCallFixture?: CallFixture }).__studioVoiceCallFixture ?? null;

let state: State = { call: null, starting: false, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

export function useCallState(): State {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
}

/** The server side of a call, over Studio's RPCs. */
export function callServer(rpc: Rpc, callId: string): CallServer {
  return {
    tool: async (name, args) => ((await rpc.call("voice_call_tool", { callId, name, args })) as { output: string }).output,
    report: async (events) => (await rpc.call("voice_call_event", { callId, events })) as { costUsd: number | null; replies: number },
    poll: async () => (await rpc.call("voice_call_poll", { callId })) as never,
    end: async (events) => (await rpc.call("voice_call_end", { callId, events })) as never,
  };
}

/** Starts a call with the Bot: mint on the server, then WebRTC to OpenAI. */
export async function startCall(rpc: Rpc, botId: string): Promise<void> {
  if (state.call || state.starting) return;
  set({ starting: true, error: null });
  try {
    const staged = fixture();
    let callId: string, botName: string, transport: RealtimeTransport;
    if (staged) ({ callId, botName, transport } = staged);
    else {
      const minted = (await rpc.call("voice_call_start", { botId })) as { callId: string; clientSecret: string; callsUrl: string; botName: string };
      callId = minted.callId;
      botName = minted.botName;
      try {
        transport = await connectWebRtc({ clientSecret: minted.clientSecret, callsUrl: minted.callsUrl });
      } catch (error) {
        // Nothing was said: close the record so the month's tally stays right.
        await rpc.call("voice_call_end", { callId, events: [] }).catch(() => {});
        throw error;
      }
    }
    const session = new CallSession(transport, callServer(rpc, callId));
    session.startPolling();
    set({ call: { callId, botName, session, transport }, starting: false });
  } catch (error) {
    set({ starting: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** Hangs up and keeps the ended call on the bar for a moment, with its record. */
export async function endCall(): Promise<void> {
  const call = state.call;
  if (!call) return;
  await call.session.hangUp();
  setTimeout(() => { if (state.call === call) set({ call: null }); }, 10_000);
}

/** Closes the ended call's bar now. */
export function dismissCall(): void {
  if (state.call && state.call.session.state.status === "ended") set({ call: null });
}
