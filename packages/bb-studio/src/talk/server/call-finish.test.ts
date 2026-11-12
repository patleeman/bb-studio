import { describe, expect, it } from "vitest";
import { memoryStore } from "../test/db";
import { CallFinisher, callContext, cleanupTurns } from "./call-finish";
import type { TalkStore } from "./store";

function callRecording(store: TalkStore, pieces: [string, "me" | "them", number, string][]) {
  const recording = store.create({ id: "rec_call00001", kind: "recording", projectId: null, threadId: null, call: { app: "zoom.us", bundleIds: ["us.zoom.xos"], mic: true, stt: "whisperkit" } });
  for (const [id, speaker, at, text] of pieces) {
    const index = Number(id.split("-")[1]);
    store.addSegment({ recordingId: recording.id, sessionId: speaker, index, startedAt: at, durationMs: 1000, mimeType: "audio/wav", bytes: 10, file: `${recording.id}/${id}.wav`, speaker, held: true });
    store.saveFinal(recording.id, id, text);
  }
  store.setStatus(recording.id, "finishing");
  return recording.id;
}

describe("after a call", () => {
  it("cleans by turn: consecutive pieces from one side, split when long", () => {
    const { store } = memoryStore();
    const id = callRecording(store, [["them-0", "them", 0, "So, um,"], ["them-1", "them", 1000, "the launch."], ["me-0", "me", 2000, "Yes."], ["them-2", "them", 3000, "Good."]]);
    expect(cleanupTurns(store.segments(id))).toEqual([
      { ids: ["them-0", "them-1"], text: "So, um, the launch." },
      { ids: ["me-0"], text: "Yes." },
      { ids: ["them-2"], text: "Good." },
    ]);
    expect(cleanupTurns(store.segments(id), 10).map((turn) => turn.ids)).toEqual([["them-0"], ["them-1"], ["me-0"], ["them-2"]]);
  });

  it("titles, summarizes, makes notes, then saves the cleanup with the labels kept", async () => {
    const { store } = memoryStore();
    const id = callRecording(store, [["them-0", "them", 0, "So, um,"], ["them-1", "them", 1000, "the launch is Friday."], ["me-0", "me", 2000, "Uh, yes."]]);
    const calls: string[] = [];
    const finisher = new CallFinisher({
      store,
      title: () => void calls.push("title"),
      summarize: async () => void calls.push("summary"),
      makeNotes: async () => void calls.push(`notes:${store.transcript(id)}`),
      clean: async (_id, text) => text.replace(/\b(um|uh),?\s*/gi, ""),
      changed: () => {},
      warn: () => {},
    });
    finisher.maybeRun(id);
    finisher.maybeRun(id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual(["title", "summary", "notes:Them: So, um, the launch is Friday.\n\nMe: Uh, yes."]);
    expect(store.cleanedTranscript(id)).toBe("Them: So, the launch is Friday.\n\nMe: yes.");
    // The original stays.
    expect(store.transcript(id)).toBe("Them: So, um, the launch is Friday.\n\nMe: Uh, yes.");
  });

  it("waits until every piece is transcribed", () => {
    const { store } = memoryStore();
    const id = callRecording(store, [["them-0", "them", 0, "Hi."]]);
    store.addSegment({ recordingId: id, sessionId: "me", index: 0, startedAt: 5, durationMs: 1000, mimeType: "audio/wav", bytes: 10, file: `${id}/me-0.wav`, speaker: "me" });
    let ran = false;
    const finisher = new CallFinisher({ store, title: () => { ran = true; }, summarize: async () => {}, makeNotes: async () => {}, clean: async () => null, changed: () => {}, warn: () => {} });
    finisher.maybeRun(id);
    expect(ran).toBe(false);
  });

  it("tells the models who Me and Them are", () => {
    expect(callContext("zoom.us")).toMatch(/"Me" is the person who recorded it; "Them" is everyone else/);
  });
});
