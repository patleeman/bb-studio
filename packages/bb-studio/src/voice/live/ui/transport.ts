// The wire under a hands-free session on the desktop.
//
// - WebRTC in the BB window: the mic (getUserMedia with echo cancellation)
//   goes up as a track, the voice comes back as one, and JSON events go both
//   ways on the "oai-events" data channel. For gpt-live-1 the SDP offer goes
//   to Studio (voiceLive.start), which creates the session with its key; for
//   gpt-realtime-2.1 the offer goes to OpenAI with a 2-minute client secret.
//   Levels come from Web Audio AnalyserNodes on both streams, for barge-in.
// - The scripted mock (a staged BB's STUDIO_VOICE_MOCK_URL): a WebSocket that
//   speaks GPT-Live's events, the voice as 24 kHz PCM played through Web
//   Audio, and the mic level the script plays (no real mic).
import { DATA_CHANNEL } from "../shared";

export interface LiveTransport {
  send(event: Record<string, unknown>): void;
  onEvent(listener: (event: Record<string, unknown>) => void): void;
  onClose(listener: (reason: string) => void): void;
  /** Barge-in: off silences the voice at once; on lets its next reply play. */
  setAgentAudio(enabled: boolean): void;
  /** The newest mic frames (linear RMS, oldest first) since the last call, and the voice's level now. */
  levels(): { mic: number[]; playback: number };
  /** The mic's name, for the header ("MacBook Pro Microphone"); empty for the mock. */
  micLabel: string;
  /** When the mic started (epoch ms), for measuring; null for the mock. */
  micOpenedAt: number | null;
  close(): void;
}

/** The RMS of an analyser's waveform: linear, 0–1. */
function meter(context: AudioContext, stream: MediaStream): () => number {
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const value of data) sum += value * value;
    return Math.sqrt(sum / data.length);
  };
}

export interface WebRtcOptions {
  /** gpt-live-1: Studio exchanges the offer. Realtime: post it to OpenAI with the secret. */
  exchange(offerSdp: string): Promise<string>;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

/** Opens the WebRTC session: mic permission, the peer connection, the SDP exchange, the data channel. */
export async function connectWebRtc(options: WebRtcOptions): Promise<LiveTransport> {
  const getUserMedia = options.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
  // Echo cancellation keeps the voice out of the mic, which barge-in by level depends on.
  const mic = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const micOpenedAt = Date.now();
  const pc = new RTCPeerConnection();
  const audio = document.createElement("audio");
  audio.autoplay = true;
  const context = new AudioContext();
  let voiceLevel: () => number = () => 0;
  let agentAudio = true;
  pc.ontrack = (event) => {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    audio.srcObject = stream;
    voiceLevel = meter(context, stream);
  };
  for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);
  const micLevel = meter(context, mic);
  const channel = pc.createDataChannel(DATA_CHANNEL);
  const listeners: ((event: Record<string, unknown>) => void)[] = [];
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
    let event: Record<string, unknown>;
    try { event = JSON.parse(String(message.data)) as Record<string, unknown>; } catch { return; }
    for (const listener of listeners) listener(event);
  };
  channel.onclose = () => { if (!closed) for (const closer of closers) closer("The voice connection closed."); };
  pc.onconnectionstatechange = () => {
    if (!closed && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) for (const closer of closers) closer("The voice connection dropped.");
  };
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await pc.setRemoteDescription({ type: "answer", sdp: await options.exchange(offer.sdp ?? "") });
    await new Promise<void>((resolve, reject) => {
      if (channel.readyState === "open") return resolve();
      const timer = setTimeout(() => reject(new Error("The voice session didn't connect.")), 15_000);
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
    setAgentAudio: (enabled) => { agentAudio = enabled; audio.muted = !enabled; },
    levels: () => ({ mic: [micLevel()], playback: agentAudio ? voiceLevel() : 0 }),
    micLabel: mic.getAudioTracks()[0]?.label ?? "",
    micOpenedAt,
    close: shutdown,
  };
}

/** Realtime: the offer goes to OpenAI with the client secret; returns the answer. */
export async function realtimeExchange(offerSdp: string, callsUrl: string, clientSecret: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(callsUrl, { method: "POST", body: offerSdp, headers: { authorization: `Bearer ${clientSecret}`, "content-type": "application/sdp" } });
  const answer = await response.text();
  if (!response.ok) throw new Error(`OpenAI refused the voice session (${response.status}): ${answer.slice(0, 200)}`);
  return answer;
}

const SAMPLE_RATE = 24_000;

/** The scripted mock: GPT-Live's events over a WebSocket, its audio played here. */
export async function connectMock(url: string): Promise<LiveTransport> {
  const socket = new WebSocket(url);
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const gain = context.createGain();
  gain.connect(context.destination);
  const listeners: ((event: Record<string, unknown>) => void)[] = [];
  const closers: ((reason: string) => void)[] = [];
  const playing: { source: AudioBufferSourceNode; end: number; level: number }[] = [];
  let playhead = 0;
  let agentAudio = true;
  let micFrames: number[] = [];
  let scriptedPlayback = 0;
  let closed = false;

  const play = (base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const samples = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    let sum = 0;
    for (let index = 0; index < samples.length; index++) { channel[index] = samples[index]! / 32768; sum += channel[index]! ** 2; }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const start = Math.max(context.currentTime, playhead);
    source.start(start);
    playhead = start + buffer.duration;
    playing.push({ source, end: playhead, level: Math.sqrt(sum / samples.length) });
  };
  const stopAll = () => {
    for (const { source } of playing) { try { source.stop(); } catch { /* Already stopped. */ } }
    playing.length = 0;
    playhead = context.currentTime;
  };

  socket.onmessage = (message) => {
    let event: Record<string, unknown>;
    try { event = JSON.parse(String(message.data)) as Record<string, unknown>; } catch { return; }
    if (event.type === "mock.audio.delta") { if (agentAudio && typeof event.audio === "string") play(event.audio); return; }
    if (event.type === "mock.levels") {
      if (Array.isArray(event.mic)) micFrames.push(...(event.mic as number[]));
      scriptedPlayback = typeof event.playback === "number" ? event.playback : 0;
      return;
    }
    for (const listener of listeners) listener(event);
  };
  socket.onclose = () => { if (!closed) for (const closer of closers) closer("The voice connection closed."); };
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error(`Couldn't reach the voice mock at ${url}.`));
  });
  void context.resume().catch(() => {});
  const send = (event: Record<string, unknown>) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)); };
  return {
    send,
    onEvent: (listener) => { listeners.push(listener); },
    onClose: (listener) => { closers.push(listener); },
    setAgentAudio: (enabled) => {
      if (enabled === agentAudio) return;
      agentAudio = enabled;
      if (!enabled) stopAll();
      // So the mock can time the mute.
      send({ type: enabled ? "mock.unmuted" : "mock.muted" });
    },
    levels: () => {
      const mic = micFrames;
      micFrames = [];
      const now = context.currentTime;
      while (playing.length && playing[0]!.end <= now) playing.shift();
      const current = playing[0];
      return { mic, playback: agentAudio ? (current?.level ?? scriptedPlayback) : 0 };
    },
    micLabel: "",
    micOpenedAt: null,
    close: () => {
      closed = true;
      stopAll();
      socket.close();
      void context.close().catch(() => {});
    },
  };
}
