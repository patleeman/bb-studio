// The wire under a voice call: WebRTC to OpenAI's Realtime API. The mic goes
// up as an audio track, the voice comes back as one, and events go both ways
// on the "oai-events" data channel. CallSession (session.ts) only sees the
// RealtimeTransport interface, so tests drive it with a fake.
import { REALTIME_DATA_CHANNEL } from "../shared";

export type ServerEvent = { type: string; [key: string]: unknown };

export interface RealtimeTransport {
  /** Sends a client event on the data channel. */
  send(event: Record<string, unknown>): void;
  /** Server events, in order. */
  onEvent(listener: (event: ServerEvent) => void): void;
  /** The connection dropped (not a hang-up). */
  onClose(listener: (reason: string) => void): void;
  /** Whether the mic track carries sound (mute, push-to-talk). */
  setMic(on: boolean): void;
  /** Rough levels from 0 to 1: the user's mic and the voice. */
  levels(): { mic: number; voice: number };
  close(): void;
}

export interface ConnectOptions {
  clientSecret: string;
  callsUrl: string;
  /** Overridable for tests. */
  fetch?: typeof fetch;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

/** A level meter on a stream: the RMS of its waveform, scaled to about 0–1. */
function meter(context: AudioContext, stream: MediaStream): () => number {
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  return () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) sum += ((value - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / data.length) * 4);
  };
}

/** Opens the call: mic permission, the peer connection, the SDP exchange, and the data channel open. */
export async function connectWebRtc(options: ConnectOptions): Promise<RealtimeTransport> {
  const getUserMedia = options.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
  const mic = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const pc = new RTCPeerConnection();
  const audio = document.createElement("audio");
  audio.autoplay = true;
  const context = new AudioContext();
  let voiceLevel: () => number = () => 0;
  pc.ontrack = (event) => {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    audio.srcObject = stream;
    voiceLevel = meter(context, stream);
  };
  for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);
  const micLevel = meter(context, mic);
  const channel = pc.createDataChannel(REALTIME_DATA_CHANNEL);
  const listeners: ((event: ServerEvent) => void)[] = [];
  const closers: ((reason: string) => void)[] = [];
  let closed = false;
  const shutdown = () => {
    closed = true;
    channel.close();
    pc.close();
    for (const track of mic.getTracks()) track.stop();
    audio.srcObject = null;
    void context.close().catch(() => {});
  };
  channel.onmessage = (message) => {
    let event: ServerEvent;
    try { event = JSON.parse(String(message.data)) as ServerEvent; } catch { return; }
    for (const listener of listeners) listener(event);
  };
  channel.onclose = () => { if (!closed) for (const closer of closers) closer("The call's connection closed."); };
  pc.onconnectionstatechange = () => {
    if (!closed && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) for (const closer of closers) closer("The call's connection dropped.");
  };
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await (options.fetch ?? fetch)(options.callsUrl, {
      method: "POST",
      body: offer.sdp,
      headers: { authorization: `Bearer ${options.clientSecret}`, "content-type": "application/sdp" },
    });
    const answer = await response.text();
    if (!response.ok) throw new Error(`OpenAI refused the call (${response.status}): ${answer.slice(0, 200)}`);
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    await new Promise<void>((resolve, reject) => {
      if (channel.readyState === "open") return resolve();
      const timer = setTimeout(() => reject(new Error("The call didn't connect.")), 15_000);
      channel.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  } catch (error) {
    shutdown();
    throw error;
  }
  return {
    send: (event) => { if (channel.readyState === "open") channel.send(JSON.stringify(event)); },
    onEvent: (listener) => { listeners.push(listener); },
    onClose: (listener) => { closers.push(listener); },
    setMic: (on) => { for (const track of mic.getAudioTracks()) track.enabled = on; },
    levels: () => ({ mic: micLevel(), voice: voiceLevel() }),
    close: shutdown,
  };
}
