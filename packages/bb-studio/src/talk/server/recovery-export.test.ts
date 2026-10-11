import { expect, it } from "vitest";
import { talkHost } from "../test/host";

it("downloads uploaded WAV audio before recovery finalizes the recording", async () => {
  const host = await talkHost();
  try {
    const { call } = host;
    const recording = await call("recordings.recording_create", { kind: "recording", projectId: null, threadId: null });
    await call("recordings.segment_put", { recordingId: recording.id, sessionId: "session123", index: 0, startedAt: 1, durationMs: 1000, mimeType: "audio/wav", audioBase64: Buffer.from("preserved WAV bytes").toString("base64") });
    await call("recordings.recording_state", { id: recording.id, status: "paused" });
    const response = await host.harness.behavior.fetchHttp("GET", `/recordings/audio-export?recording=${recording.id}`);
    expect(response.status).toBe(200);
    const archive = Buffer.from(await response.arrayBuffer());
    expect(archive.subarray(0, 100).toString().replace(/\0.*$/s, "")).toBe("0001.wav");
    expect(archive.includes(Buffer.from("preserved WAV bytes"))).toBe(true);
    const segment = await host.harness.behavior.fetchHttp("GET", `/recordings/audio?recording=${recording.id}&segment=session123-0&download=1`);
    expect(segment.headers.get("content-disposition")).toContain("session123-0.wav");
    const bundle = await host.talk.provider.studio_export({ id: recording.id, format: "bundle" });
    expect(bundle.files.some((file: { name: string }) => file.name === "0001.wav")).toBe(true);
    expect((await call("recordings.recording_get", { id: recording.id })).recording.status).toBe("paused");
  } finally { await host.harness.lifecycle.dispose(); }
});
