import { describe, expect, it } from "vitest";
import { callRetentionDays, callSttFor, knownCallInfo } from "../shared/contract";
import { checkSetting, STUDIO_SETTINGS } from "../../settings/schema";
import { joinTranscript } from "../shared/format";
import { memoryStore } from "../test/db";

const DAY = 86_400_000;
const call = { app: "zoom.us", bundleIds: ["us.zoom.xos"], mic: true, stt: "whisperkit" as const };

describe("call storage", () => {
  it("labels turns when pieces have a side, and leaves other recordings alone", () => {
    expect(joinTranscript([
      { sessionId: "them", speaker: "them", text: "Hi." },
      { sessionId: "them", speaker: "them", text: "How are you?" },
      { sessionId: "me", speaker: "me", text: "Good." },
    ])).toBe("Them: Hi. How are you?\n\nMe: Good.");
    expect(joinTranscript([{ sessionId: "a", text: "One" }, { sessionId: "a", text: "two" }, { sessionId: "b", text: "Three" }])).toBe("One two\n\nThree");
  });

  it("expires a finished call's audio after the retention period, keeping its transcript", () => {
    let now = 1_000 * DAY;
    const { store } = memoryStore(() => now);
    const old = store.create({ id: "rec_callold001", kind: "recording", projectId: null, threadId: null, call });
    store.addSegment({ recordingId: old.id, sessionId: "them", index: 0, startedAt: now, durationMs: 1000, mimeType: "audio/wav", bytes: 1, file: `${old.id}/them-0.wav`, speaker: "them" });
    store.markTranscribed(old.id, "them-0", "Hello");
    store.setStatus(old.id, "finishing");
    const plain = store.create({ id: "rec_plain00001", kind: "recording", projectId: null, threadId: null });
    store.setStatus(plain.id, "finishing");
    now += 10 * DAY;
    expect(store.callAudioExpired(now - 30 * DAY)).toEqual([]);
    expect(store.callAudioExpired(now - 7 * DAY)).toEqual([old.id]);
    store.markAudioRemoved(old.id);
    expect(store.callAudioExpired(now)).toEqual([]);
    expect(store.recording(old.id)).toMatchObject({ audioRemoved: true, wordCount: 1 });
    expect(store.transcript(old.id)).toBe("Them: Hello");
  });

  it("keeps a call's audio while a piece still waits to transcribe", () => {
    let now = 1_000 * DAY;
    const { store } = memoryStore(() => now);
    const { id } = store.create({ id: "rec_callwait01", kind: "recording", projectId: null, threadId: null, call });
    store.addSegment({ recordingId: id, sessionId: "them", index: 0, startedAt: now, durationMs: 1000, mimeType: "audio/wav", bytes: 1, file: `${id}/them-0.wav`, speaker: "them" });
    store.markFailed(id, "them-0", "offline", null);
    store.setStatus(id, "finishing");
    now += 40 * DAY;
    expect(store.callAudioExpired(now - 7 * DAY)).toEqual([]);
  });

  it("deletes the transcript with the recording", () => {
    const { store } = memoryStore();
    const { id } = store.create({ id: "rec_calldel001", kind: "recording", projectId: null, threadId: null, call });
    store.addSegment({ recordingId: id, sessionId: "me", index: 0, startedAt: 1, durationMs: 1000, mimeType: "audio/wav", bytes: 1, file: `${id}/me-0.wav`, speaker: "me" });
    expect(store.delete(id)).toBe(true);
    expect(store.segments(id)).toEqual([]);
  });
});

describe("call settings", () => {
  it("defaults to local WhisperKit and 30 days of audio", () => {
    expect(STUDIO_SETTINGS.callTranscription.default).toBe("Local (WhisperKit)");
    expect(STUDIO_SETTINGS.callAudioRetention.options).toEqual(["7 days", "30 days", "Forever"]);
    expect(STUDIO_SETTINGS.callAudioRetention.default).toBe("30 days");
    // No server and no secret by default.
    expect(STUDIO_SETTINGS.callServerUrl.default).toBe("");
  });

  it("reads a call or a setting saved under an earlier home-server name as the home server", () => {
    expect(knownCallInfo({ ...call, stt: "old-name" }).stt).toBe("home-server");
    expect(knownCallInfo(call)).toBe(call);
    expect(checkSetting("callTranscription", "Home server (old name)")).toEqual({ ok: true, value: "Home server" });
    expect(checkSetting("callTranscription", "Elsewhere").ok).toBe(false);
  });

  it("maps each choice", () => {
    expect(callSttFor("Local (WhisperKit)")).toBe("whisperkit");
    expect(callSttFor("Home server")).toBe("home-server");
    expect(callSttFor("BB voice service")).toBe("voice-service");
    expect(callSttFor(undefined)).toBe("whisperkit");
    expect(callRetentionDays("7 days")).toBe(7);
    expect(callRetentionDays("30 days")).toBe(30);
    expect(callRetentionDays("Forever")).toBeNull();
    expect(callRetentionDays(undefined)).toBe(30);
  });
});
