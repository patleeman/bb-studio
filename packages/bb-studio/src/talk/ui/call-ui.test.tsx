// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CallLive, Recording, Segment } from "../shared/contract";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Icon: () => null,
  useRealtime: () => {},
  useRpc: () => ({ call: async () => ({ active: null, consented: true }) }),
  useSettings: () => ({ values: {} }),
}));
vi.mock("../../kit/app/index", () => ({ openAppPath: vi.fn() }));

const { CallBar, CallTranscript } = await import("./call-ui");

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const live: CallLive = {
  recordingId: "rec_call00001", app: "zoom.us", mic: true, startedAt: Date.now() - 65_000, phase: "recording",
  partials: [{ speaker: "them", index: 1, text: "And the budget", startMs: 9000 }], levels: { me: 0.2, them: 0.5 }, error: null, model: null, fallback: false,
};

it("shows the red bar with the app, the time and Stop", () => {
  const onStop = vi.fn();
  act(() => root.render(<CallBar live={live} onStop={onStop} />));
  expect(host.textContent).toMatch(/Recording call: zoom\.us · 1:0[5-6]/);
  const stop = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Stop"))!;
  act(() => stop.click());
  expect(onStop).toHaveBeenCalledTimes(1);
});

it("says when the model is downloading or local transcription fell back", () => {
  act(() => root.render(<CallBar live={{ ...live, model: { stage: "download", progress: 0.42 } }} onStop={() => {}} />));
  expect(host.textContent).toContain("Downloading the transcription model · 42%");
  act(() => root.render(<CallBar live={{ ...live, fallback: true }} onStop={() => {}} />));
  expect(host.textContent).toContain("using BB's voice service");
});

it("shows Me and Them turns, with the live partial", () => {
  const segment = (id: string, speaker: "me" | "them", startedAt: number, text: string): Segment => ({
    id, sessionId: speaker, startedAt, offsetMs: startedAt - live.startedAt, durationMs: 4000, mimeType: "audio/wav", bytes: 1, status: "done", text, error: null, attempts: 0, speaker,
  });
  const segments = [segment("them-0", "them", live.startedAt, "Shall we start?"), segment("me-0", "me", live.startedAt + 4500, "Yes, let's.")];
  act(() => root.render(<CallTranscript recording={{ id: live.recordingId } as Recording} segments={segments} live={live} />));
  const turns = [...host.querySelectorAll("section")].map((section) => section.textContent);
  expect(turns).toEqual(["Them0:00Shall we start?", "Me0:04Yes, let's.", "Them0:09And the budget"]);
});
