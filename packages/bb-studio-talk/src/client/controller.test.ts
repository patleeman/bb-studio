// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TalkController } from "./controller";
import { Outbox, type OutboxSegment } from "./outbox";
import { registerComposerSource } from "./composer-source";
import { insertDictationIntoComposer } from "./composer-dom";
import { addPending, readPending, writePending } from "./pending-inserts";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));
vi.mock("./composer-dom", async importOriginal => ({ ...await importOriginal<typeof import("./composer-dom")>(), insertDictationIntoComposer: vi.fn(async () => true) }));

class Recorder extends EventTarget {
  static instances: Recorder[] = [];
  static isTypeSupported() { return true; }
  state = "inactive";
  mimeType = "audio/webm";
  constructor() { super(); Recorder.instances.push(this); }
  start() { this.state = "recording"; }
  emit(bytes: number[]) {
    const event = new Event("dataavailable");
    Object.defineProperty(event, "data", { value: new NodeBlob([new Uint8Array(bytes)]) });
    this.dispatchEvent(event);
  }
  stop() {
    this.state = "inactive";
    this.emit([9]); // Browsers emit the remaining audio before the stop event.
    this.dispatchEvent(new Event("stop"));
  }
}

const stopped = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  localStorage.clear();
  Recorder.instances = [];
  stopped.mockClear();
  vi.mocked(insertDictationIntoComposer).mockClear();
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("AudioContext", class {
    resume = async () => {};
    close = async () => {};
    createAnalyser = () => ({ fftSize: 2048, getFloatTimeDomainData: () => {} });
    createMediaStreamSource = () => ({ connect: () => {} });
  });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: async () => ({ getTracks: () => [{ stop: stopped }], getAudioTracks: () => [{ addEventListener: () => {} }] }),
  } });
  vi.spyOn(Outbox.prototype, "begin").mockResolvedValue();
  vi.spyOn(Outbox.prototype, "appendPart").mockResolvedValue();
  vi.spyOn(Outbox.prototype, "complete").mockResolvedValue();
  vi.spyOn(Outbox.prototype, "all").mockResolvedValue([]);
  vi.spyOn(Outbox.prototype, "sealOrphans").mockResolvedValue(0);
  vi.spyOn(Outbox.prototype, "restore").mockResolvedValue();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["begin", "appendPart", "complete"] as const)("stops capture and retains every chunk after %s fails", async (method) => {
  vi.mocked(Outbox.prototype[method]).mockRejectedValueOnce(new Error("Disk full"));
  const recording = { id: "rec_test", durationMs: 0, status: "recording" };
  const call = vi.fn(async (method: string, _input?: unknown) => method === "recording_get" ? { recording, segments: [] } : recording);
  const controller = new TalkController();
  controller.attach({ call } as never);
  await vi.waitFor(() => expect(controller.getState().setAside).not.toBeNull());
  await controller.startRecording("dictation");
  const recorder = Recorder.instances[0]!;
  if (method !== "begin") recorder.emit([1, 2]);
  if (method === "complete") await controller.stop(true);
  await vi.waitFor(() => {
    expect(controller.getState().phase).toBe("storage-error");
    expect(stopped).toHaveBeenCalled();
  });
  expect(recorder.state).toBe("inactive");
  expect(controller.getState().localSaveError).toBe("Disk full");
  expect(call.mock.calls.some(([method, input]) => method === "recording_state" && (input as { status?: string })?.status === "finishing")).toBe(false);
  expect(JSON.parse(localStorage.getItem("bb-plugin-talk:active")!).insert).toBe(false);

  // Neither Stop nor a successful uploader pass may dismiss incomplete audio.
  await controller.stop(true);
  await controller.kickUpload();
  expect(controller.getState().phase).toBe("storage-error");

  const createObjectURL = vi.fn((_blob: Blob) => "blob:recovered-audio");
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await controller.downloadLocalAudio();
  const downloaded = createObjectURL.mock.calls[0]![0] as unknown as NodeBlob;
  expect([...new Uint8Array(await downloaded.arrayBuffer())]).toEqual(method === "begin" ? [9] : [1, 2, 9]);
  expect(click).toHaveBeenCalledOnce();
  expect(controller.getState().localSaveError).toBe("Disk full");

  // A failed recovery keeps the same memory copy available for another try.
  vi.mocked(Outbox.prototype.restore).mockRejectedValueOnce(new Error("Still full"));
  await controller.retryLocalAudio();
  expect(controller.getState().localSaveError).toBe("Still full");
  await controller.retryLocalAudio();
  const restored = vi.mocked(Outbox.prototype.restore).mock.calls.at(-1)![0] as OutboxSegment;
  expect(restored.parts.flatMap((part) => [...new Uint8Array(part)])).toEqual(method === "begin" ? [9] : [1, 2, 9]);
  expect(restored.complete).toBe(true);
  expect(controller.getState().localSaveError).toBeNull();
  expect(controller.getState().phase).toBe("paused");
  expect(JSON.parse(localStorage.getItem("bb-plugin-talk:active")!).insert).toBe(false);
});


it("dictates into a retained thread companion while the main thread changes", async () => {
  const wrapper = document.createElement("div"); wrapper.dataset.floatWindow = "thread:thr_side";
  const prompt = document.createElement("div"); prompt.dataset.promptbox = "";
  Object.defineProperty(prompt, "offsetParent", { get: () => wrapper.hidden ? null : document.body });
  wrapper.append(prompt); document.body.append(wrapper);
  const unregister = registerComposerSource(prompt, () => ({ kind: "thread", threadId: "thr_main" }));
  const recording = { id: "rec_source", durationMs: 0, status: "recording" };
  const call = vi.fn(async (method: string) => method === "recording_get" ? { recording, segments: [] } : recording);
  const controller = new TalkController(); controller.attach({ call } as never);
  controller.setContext({ projectId: "proj_main", threadId: "thr_main" });
  const navigate = { toThread: vi.fn(), toPluginPanel: vi.fn(), toCompose: vi.fn() };
  const open = vi.fn(); controller.setNavigator(navigate as never, open);
  await controller.startRecording("dictation", prompt);
  expect(controller.getState().threadId).toBe("thr_side");
  expect(call).toHaveBeenCalledWith("recording_create", { kind: "dictation", threadId: "thr_side", projectId: null });
  controller.setContext({ projectId: "proj_other", threadId: "thr_other" });
  expect(controller.dictationComposer()).toBe(prompt);
  expect(controller.isAtSource()).toBe(true);
  wrapper.hidden = true; expect(controller.isAtSource()).toBe(false);
  expect(controller.dictationComposer()).toBeNull();
  controller.goToSource(); expect(open).toHaveBeenCalledWith({ kind: "thread", threadId: "thr_side" });
  expect(navigate.toThread).not.toHaveBeenCalled();
  unregister(); await controller.stop(false);
});

it("returns to the exact new-conversation route and selected project", async () => {
  const wrapper = document.createElement("div"); wrapper.dataset.floatWindow = "path:/plugins/pages/pages/pg_source/compose";
  const prompt = document.createElement("div"); prompt.dataset.promptbox = ""; wrapper.append(prompt); document.body.append(wrapper);
  Object.defineProperty(prompt, "offsetParent", { value: document.body });
  const unregister = registerComposerSource(prompt, () => ({ kind: "new-thread", projectId: "proj_selected" }));
  const recording = { id: "rec_compose", durationMs: 0, status: "recording" };
  const call = vi.fn(async (method: string) => method === "recording_get" ? { recording, segments: [] } : recording);
  const controller = new TalkController(); controller.attach({ call } as never);
  controller.setContext({ projectId: "proj_main", threadId: "thr_main" });
  const navigate = { toThread: vi.fn(), toPluginPanel: vi.fn(), toCompose: vi.fn() };
  const open = vi.fn(); controller.setNavigator(navigate as never, open);
  await controller.startRecording("dictation", prompt);
  expect(controller.getState().threadId).toBeNull();
  expect(call).toHaveBeenCalledWith("recording_create", { kind: "dictation", threadId: null, projectId: "proj_selected" });
  controller.goToSource(); expect(open).toHaveBeenCalledWith({ kind: "path", path: "/plugins/pages/pages/pg_source/compose" });
  expect(navigate.toCompose).not.toHaveBeenCalled();
  unregister(); await controller.stop(false);
});


it("delivers waiting dictation to the visible companion rather than the main thread", async () => {
  const wrapper = document.createElement("div"); wrapper.dataset.floatWindow = "thread:thr_side";
  const prompt = document.createElement("div"); prompt.dataset.promptbox = "";
  Object.defineProperty(prompt, "offsetParent", { value: document.body });
  wrapper.append(prompt); document.body.append(wrapper);
  writePending(addPending({}, "thr_side", "The side conversation's dictation."));
  const controller = new TalkController();
  controller.setContext({ threadId: "thr_main", projectId: "proj_main" });
  controller.attach({ call: vi.fn() } as never);
  await vi.advanceTimersByTimeAsync(1500);
  expect(insertDictationIntoComposer).toHaveBeenCalledWith(prompt, "The side conversation's dictation.", []);
  expect(readPending()).toEqual({});
});

it("holds a new draft's pending dictation until that exact companion is visible", async () => {
  const wrapper = document.createElement("div"); wrapper.dataset.floatWindow = "path:/plugins/pages/pages/pg_source/compose"; wrapper.hidden = true;
  const prompt = document.createElement("div"); prompt.dataset.promptbox = "";
  Object.defineProperty(prompt, "offsetParent", { get: () => wrapper.hidden ? null : document.body });
  wrapper.append(prompt); document.body.append(wrapper);
  const key = "compose:/plugins/pages/pages/pg_source/compose";
  writePending(addPending({}, key, "Return to the original draft."));
  const controller = new TalkController();
  controller.setContext({ threadId: "thr_main", projectId: "proj_main" });
  controller.attach({ call: vi.fn() } as never);
  await vi.advanceTimersByTimeAsync(1500);
  expect(insertDictationIntoComposer).not.toHaveBeenCalled();
  expect(controller.threadRowStatuses().size).toBe(0);
  wrapper.hidden = false;
  await vi.advanceTimersByTimeAsync(1500);
  expect(insertDictationIntoComposer).toHaveBeenCalledWith(prompt, "Return to the original draft.", []);
  expect(readPending()).toEqual({});
});
