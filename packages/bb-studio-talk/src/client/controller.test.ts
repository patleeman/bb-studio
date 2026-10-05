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
  expect(JSON.parse(localStorage.getItem("bb-plugin-talk:active")!).localSaveFailed).toBe(true);

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
  expect(JSON.parse(localStorage.getItem("bb-plugin-talk:active")!).localSaveFailed).toBe(false);
});

it("reports a memory-only tail lost on reload and blocks completion until acknowledged", async () => {
  localStorage.setItem("bb-plugin-talk:active", JSON.stringify({ recordingId: "rec_lost", kind: "dictation", phase: "paused", threadId: "thr_origin", insert: true, localSaveFailed: true }));
  const recording = { id: "rec_lost", durationMs: 2000, status: "paused" };
  const call = vi.fn(async (method: string) => method === "recording_get" ? { recording, segments: [] } : recording);
  const controller = new TalkController();
  controller.attach({ call } as never);
  await vi.waitFor(() => expect(controller.getState().localAudioLost).toBe(true));
  expect(controller.getState()).toMatchObject({ phase: "storage-error", threadId: "thr_origin" });
  await controller.stop(true);
  await controller.retryLocalAudio();
  expect(controller.getState().phase).toBe("storage-error");
  expect(Recorder.instances).toHaveLength(0);
  expect(call.mock.calls.some(([method]) => method === "recording_state")).toBe(false);
  expect(insertDictationIntoComposer).not.toHaveBeenCalled();
  controller.acknowledgeAudioLoss();
  expect(controller.getState()).toMatchObject({ phase: "paused", localAudioLost: false, localSaveError: null });
  expect(JSON.parse(localStorage.getItem("bb-plugin-talk:active")!)).toMatchObject({ insert: false, localSaveFailed: false });
});

it("retains recovery metadata when the network is online but the recording RPC fails", async () => {
  const saved = { recordingId: "rec_offline", kind: "dictation", phase: "paused", threadId: "thr_origin", insert: false, localSaveFailed: true };
  localStorage.setItem("bb-plugin-talk:active", JSON.stringify(saved));
  const call = vi.fn(async (method: string) => { if (method === "recording_get") throw new Error("Service unavailable"); return {}; });
  const controller = new TalkController(); controller.attach({ call } as never);
  await vi.waitFor(() => expect(call).toHaveBeenCalledWith("recording_get", { id: "rec_offline" }));
  await Promise.resolve();
  expect(JSON.parse(localStorage.getItem("bb-plugin-talk:active")!)).toEqual(saved);
  expect(controller.getState()).toMatchObject({ phase: "storage-error", localAudioLost: true });
  expect(insertDictationIntoComposer).not.toHaveBeenCalled();
});

it("refuses capture and releases the microphone when its recovery marker cannot be saved", async () => {
  const recording = { id: "rec_denied", durationMs: 0, status: "recording" };
  const call = vi.fn(async () => recording);
  const controller = new TalkController(); controller.attach({ call } as never);
  await vi.waitFor(() => expect(controller.getState().setAside).not.toBeNull());
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
  await controller.startRecording("dictation");
  expect(Recorder.instances).toHaveLength(0);
  expect(stopped).toHaveBeenCalled();
  expect(controller.getState().phase).toBe("idle");
});

it("keeps a pre-capture warning when both audio and later marker writes fail", async () => {
  const recording = { id: "rec_interrupted", durationMs: 0, status: "recording" };
  const call = vi.fn(async (method: string) => method === "recording_get" ? { recording, segments: [] } : recording);
  const controller = new TalkController(); controller.attach({ call } as never);
  await vi.waitFor(() => expect(controller.getState().setAside).not.toBeNull());
  await controller.startRecording("dictation");
  expect(JSON.parse(localStorage.getItem("bb-plugin-talk:active")!).captureInProgress).toBe(true);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
  vi.mocked(Outbox.prototype.appendPart).mockRejectedValueOnce(new Error("Disk full"));
  Recorder.instances[0]!.emit([1, 2]);
  await vi.waitFor(() => expect(controller.getState().phase).toBe("storage-error"));
  expect(JSON.parse(localStorage.getItem("bb-plugin-talk:active")!).localSaveFailed).toBe(false);
  const reloaded = new TalkController(); reloaded.attach({ call } as never);
  await vi.waitFor(() => expect(reloaded.getState().localAudioLost).toBe(true));
  expect(reloaded.getState().localSaveError).toContain("may be missing");
  await reloaded.stop(true);
  expect(reloaded.getState().phase).toBe("storage-error");
  expect(Recorder.instances).toHaveLength(1);
  expect(insertDictationIntoComposer).not.toHaveBeenCalled();
});

it("dictates into the thread of the composer it started in, such as a split's, while the main thread changes", async () => {
  const wrapper = document.createElement("div");
  const prompt = document.createElement("div"); prompt.dataset.promptbox = "";
  Object.defineProperty(prompt, "offsetParent", { get: () => wrapper.hidden ? null : document.body });
  wrapper.append(prompt); document.body.append(wrapper);
  const unregister = registerComposerSource(prompt, () => ({ kind: "thread", threadId: "thr_side" }));
  const recording = { id: "rec_source", durationMs: 0, status: "recording" };
  const call = vi.fn(async (method: string) => method === "recording_get" ? { recording, segments: [] } : recording);
  const controller = new TalkController(); controller.attach({ call } as never);
  controller.setContext({ projectId: "proj_main", threadId: "thr_main" });
  const navigate = { toThread: vi.fn(), toPluginPanel: vi.fn(), toCompose: vi.fn() };
  const open = vi.fn(); controller.setNavigator(navigate as never, open);
  await controller.startRecording("dictation", prompt);
  expect(controller.getState().threadId).toBe("thr_side");
  expect(call).toHaveBeenCalledWith("recording_create", { kind: "dictation", threadId: "thr_side", projectId: "proj_main" });
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
  const path = "/plugins/pages/pages/pg_source/compose";
  history.pushState(null, "", path);
  const prompt = document.createElement("div"); prompt.dataset.promptbox = ""; document.body.append(prompt);
  Object.defineProperty(prompt, "offsetParent", { value: document.body });
  const unregister = registerComposerSource(prompt, () => ({ kind: "new-thread", projectId: "proj_selected" }));
  const recording = { id: "rec_compose", durationMs: 0, status: "recording" };
  const call = vi.fn(async (method: string) => method === "recording_get" ? { recording, segments: [] } : recording);
  const controller = new TalkController(); controller.attach({ call } as never);
  controller.setContext({ projectId: "proj_main", threadId: "thr_main" });
  const navigate = { toThread: vi.fn(), toPluginPanel: vi.fn(), toCompose: vi.fn() };
  const open = vi.fn(); controller.setNavigator(navigate as never, open);
  await controller.startRecording("dictation", prompt);
  history.pushState(null, "", "/threads/thr_elsewhere");
  expect(controller.getState().threadId).toBeNull();
  expect(call).toHaveBeenCalledWith("recording_create", { kind: "dictation", threadId: null, projectId: "proj_selected" });
  controller.goToSource(); expect(open).toHaveBeenCalledWith({ kind: "path", path });
  expect(navigate.toCompose).not.toHaveBeenCalled();
  unregister(); await controller.stop(false);
  history.pushState(null, "", "/");
});

it("delivers waiting dictation to the visible composer of its thread rather than the main thread's", async () => {
  const prompt = document.createElement("div"); prompt.dataset.promptbox = "";
  Object.defineProperty(prompt, "offsetParent", { value: document.body });
  document.body.append(prompt);
  const unregister = registerComposerSource(prompt, () => ({ kind: "thread", threadId: "thr_side" }));
  writePending(addPending({}, "thr_side", "The side conversation's dictation."));
  const controller = new TalkController();
  controller.setContext({ threadId: "thr_main", projectId: "proj_main" });
  controller.attach({ call: vi.fn() } as never);
  await vi.advanceTimersByTimeAsync(1500);
  expect(insertDictationIntoComposer).toHaveBeenCalledWith(prompt, "The side conversation's dictation.", []);
  expect(readPending()).toEqual({});
  unregister();
});

it("holds a new draft's pending dictation until its page's composer is visible", async () => {
  const path = "/plugins/pages/pages/pg_source/compose";
  history.pushState(null, "", path);
  const wrapper = document.createElement("div"); wrapper.hidden = true;
  const prompt = document.createElement("div"); prompt.dataset.promptbox = "";
  Object.defineProperty(prompt, "offsetParent", { get: () => wrapper.hidden ? null : document.body });
  wrapper.append(prompt); document.body.append(wrapper);
  const unregister = registerComposerSource(prompt, () => ({ kind: "new-thread", projectId: "proj_selected" }));
  writePending(addPending({}, `compose:${path}`, "Return to the original draft."));
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
  unregister();
  history.pushState(null, "", "/");
});


it("neither inserts nor finishes a dictation while one of its pieces is set aside", async () => {
  const recording = { id: "rec_partial", kind: "dictation", durationMs: 50_000, status: "done", wordCount: 4, failedCount: 0, pendingCount: 0 };
  const segments = [{ sessionId: "s", status: "done", text: "Only the first half.", error: null }];
  const call = vi.fn(async (method: string) => method === "recording_get" ? { recording, segments } : recording);
  const controller = new TalkController(); controller.attach({ call } as never);
  await vi.waitFor(() => expect(controller.getState().setAside).not.toBeNull());
  await controller.startRecording("dictation");
  const setAside = { recordingId: "rec_partial", sessionId: "s", index: 1, startedAt: 1, mimeType: "audio/webm", lastPartAt: 1, durationMs: 25_000, complete: true, rejected: "Invalid input", parts: [new ArrayBuffer(1)] };
  vi.mocked(Outbox.prototype.all).mockResolvedValue([setAside]);
  await controller.stop(true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(call).not.toHaveBeenCalledWith("recording_state", { id: "rec_partial", status: "finishing" });
  expect(call).toHaveBeenCalledWith("recording_state", { id: "rec_partial", status: "paused" });
  expect(controller.getState().phase).toBe("idle");
  expect(insertDictationIntoComposer).not.toHaveBeenCalled();
});

it("does not let the server discard a recording as empty while its audio is set aside", async () => {
  const recording = { id: "rec_setaside", kind: "recording", durationMs: 0, status: "recording", wordCount: 0, failedCount: 0, pendingCount: 0 };
  const call = vi.fn(async (method: string) => method === "recording_get" ? { recording, segments: [] } : recording);
  const controller = new TalkController(); controller.attach({ call } as never);
  await vi.waitFor(() => expect(controller.getState().setAside).not.toBeNull());
  await controller.startRecording("recording");
  const setAside = { recordingId: "rec_setaside", sessionId: "s", index: 0, startedAt: 1, mimeType: "audio/webm", lastPartAt: 1, durationMs: 25_000, complete: true, rejected: "Invalid input", parts: [new ArrayBuffer(1)] };
  vi.mocked(Outbox.prototype.all).mockResolvedValue([setAside]);
  const { toast } = await import("sonner");
  await controller.stop(false);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(call).not.toHaveBeenCalledWith("recording_state", { id: "rec_setaside", status: "finishing" });
  expect(vi.mocked(toast.info).mock.calls.flat().join(" ")).not.toMatch(/heard nothing|no speech/);
  expect(vi.mocked(toast.error).mock.calls.flat().join(" ")).toMatch(/kept on this device/);
  expect(controller.getState().phase).toBe("idle");
});

it("finishes a paused recording another window left, but not while its audio is still here", async () => {
  const recording = { id: "rec_left", kind: "recording", durationMs: 20_000, status: "paused", wordCount: 3, failedCount: 0, pendingCount: 0 };
  const call = vi.fn(async (method: string) => method === "recording_get" ? { recording, segments: [] } : recording);
  const controller = new TalkController(); controller.attach({ call } as never);
  await vi.waitFor(() => expect(controller.getState().setAside).not.toBeNull());
  const local = { recordingId: "rec_left", sessionId: "s", index: 0, startedAt: 1, mimeType: "audio/webm", lastPartAt: 1, durationMs: 1000, complete: true, parts: [new ArrayBuffer(1)] };
  vi.mocked(Outbox.prototype.all).mockResolvedValue([local]);
  await expect(controller.finishRecording("rec_left")).rejects.toThrow(/still on this device/);
  expect(call).not.toHaveBeenCalledWith("recording_state", expect.anything());
  vi.mocked(Outbox.prototype.all).mockResolvedValue([]);
  await controller.finishRecording("rec_left");
  expect(call).toHaveBeenCalledWith("recording_state", { id: "rec_left", status: "finishing" });
  expect(controller.getState().phase).toBe("idle");
});

it("treats an older live-capture record without its marker as interrupted, not resumed", async () => {
  localStorage.setItem("bb-plugin-talk:active", JSON.stringify({ recordingId: "rec_legacy", kind: "dictation", phase: "recording", threadId: "thr_origin", insert: true }));
  const recording = { id: "rec_legacy", durationMs: 4000, status: "recording" };
  const call = vi.fn(async (method: string) => method === "recording_get" ? { recording, segments: [] } : recording);
  const controller = new TalkController(); controller.attach({ call } as never);
  await vi.waitFor(() => expect(call).toHaveBeenCalledWith("recording_get", { id: "rec_legacy" }));
  await vi.advanceTimersByTimeAsync(100);
  expect(controller.getState()).toMatchObject({ phase: "storage-error", localAudioLost: true });
  expect(Recorder.instances).toHaveLength(0);
  expect(insertDictationIntoComposer).not.toHaveBeenCalled();
});

it("lets only one window take a waiting dictation", async () => {
  const tails = new Map<string, Promise<unknown>>();
  const locks = { request: (name: string, ...rest: unknown[]) => {
    const callback = rest.at(-1) as (lock: unknown) => unknown;
    if (rest.length > 1) return Promise.resolve(callback({ name }));
    const run = (tails.get(name) ?? Promise.resolve()).then(() => callback({ name }));
    tails.set(name, run.catch(() => {}));
    return run;
  } };
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
  try {
    const wrapper = document.createElement("div"); wrapper.dataset.floatWindow = "thread:thr_side";
    const prompt = document.createElement("div"); prompt.dataset.promptbox = "";
    Object.defineProperty(prompt, "offsetParent", { value: document.body });
    wrapper.append(prompt); document.body.append(wrapper);
    writePending(addPending({}, "thr_side", "Only once."));
    // Another window is mid-claim: it holds the lock and takes the dictation.
    let release!: () => void;
    void locks.request("bb-plugin-talk:pending-inserts", () => new Promise<void>((resolve) => (release = resolve)));
    const controller = new TalkController();
    controller.attach({ call: vi.fn() } as never);
    await vi.advanceTimersByTimeAsync(1500);
    expect(insertDictationIntoComposer).not.toHaveBeenCalled();
    writePending({});
    release();
    await vi.advanceTimersByTimeAsync(1500);
    expect(insertDictationIntoComposer).not.toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(navigator, "locks");
  }
});
