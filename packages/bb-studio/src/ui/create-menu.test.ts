// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderView } from "../contract";
import { NEW_CALL_EVENT } from "../talk/shared/format";
import { createEntries, newItemProject, runCreateEntry, startsGroup } from "./create-menu";

const kind = (id: string, label: string, extra: Record<string, unknown> = {}) => ({ id, label, plural: `${label}s`, icon: "File", columns: [], actions: [], create: { mode: "rpc" as const }, canArchive: true, blurb: "", ...extra });
const provider = (pluginId: string, kinds: ReturnType<typeof kind>[], state = "ready") => ({ pluginId, name: pluginId, state, detail: null, panel: null, kinds }) as unknown as ProviderView;
const providers = [
  provider("design", [kind("design", "Design")]),
  provider("talk", [kind("recording", "Recording", { create: { mode: "event", event: "talk:new" } }), kind("dictation", "Dictation", { create: null })]),
  provider("pages", [kind("page", "Page")]),
  provider("draw", [kind("drawing", "Drawing", { create: null }), kind("sketch", "Sketch", { capabilities: { create: false } })]),
  provider("notion", [kind("notion-page", "Notion page")], "offline"),
];
const labels = (entries: ReturnType<typeof createEntries>) => entries.map((entry) => entry.label);

afterEach(() => vi.restoreAllMocks());

it("lists the kinds Studio can make in Studio's order, then Record a call and the meeting agent, then templates", () => {
  const entries = createEntries(providers, { templates: [{ pluginId: "pages", id: "pg_t", title: "Weekly" }] });
  expect(labels(entries)).toEqual(["Page", "Drawing", "Recording", "Design", "Record a call", "Start a meeting agent", "From template: Weekly"]);
  expect(entries.map((_, index) => startsGroup(entries, index))).toEqual([false, false, false, false, true, false, false]);
});

it("offers a whiteboard after Page, made as a page holding one, not as a bare drawing", () => {
  const keys = createEntries(providers).map((entry) => entry.key);
  expect(keys).not.toContain("draw:drawing");
  expect(keys.indexOf("excalidraw:whiteboard")).toBe(keys.indexOf("pages:page") + 1);
  expect(createEntries(providers, { off: new Set(["drawing"]) }).map((entry) => entry.key)).not.toContain("excalidraw:whiteboard");
});

it("New → Whiteboard makes its page and opens it", async () => {
  const call = vi.fn().mockResolvedValue({ drawingId: "drw_1", page: { id: "pg_1", title: "Untitled whiteboard", href: "/plugins/studio/studio/pages/pg_1" } });
  const entry = createEntries(providers).find((each) => each.type === "whiteboard")!;
  await runCreateEntry(entry, { rpc: { call }, projectId: "proj_1" });
  expect(call).toHaveBeenCalledWith("drawings.newWhiteboardPage", { projectId: "proj_1" });
});

it("opens what it made through the caller's opener, so a thread's Studio tab keeps it beside the thread", async () => {
  const call = vi.fn().mockResolvedValue({ drawingId: "drw_1", page: { id: "pg_1", title: "Untitled whiteboard", href: "/plugins/studio/studio/pages/pg_1" } });
  const open = vi.fn();
  await runCreateEntry(createEntries(providers).find((each) => each.type === "whiteboard")!, { rpc: { call }, projectId: null, open });
  expect(open).toHaveBeenCalledWith("/plugins/studio/studio/pages/pg_1");
  const template = createEntries(providers, { templates: [{ pluginId: "pages", id: "pg_t", title: "Weekly" }] }).find((each) => each.type === "template")!;
  vi.spyOn(window, "prompt").mockReturnValue("Week 12");
  const made = vi.fn().mockResolvedValue({ item: { href: "/plugins/studio/studio/pages/pg_2" } });
  await runCreateEntry(template, { rpc: { call: made }, projectId: null, open });
  expect(open).toHaveBeenLastCalledWith("/plugins/studio/studio/pages/pg_2");
});

it("drops what Setup → Kinds turned off, and Record a call with recordings", () => {
  expect(labels(createEntries(providers, { off: new Set(["recording", "design", "drawing"]) }))).toEqual(["Page"]);
  expect(labels(createEntries(providers.filter((each) => each.pluginId !== "talk")))).not.toContain("Record a call");
  expect(labels(createEntries(providers.filter((each) => each.pluginId !== "talk")))).not.toContain("Start a meeting agent");
});

it("Record a call opens the call picker", async () => {
  const picked = vi.fn();
  window.addEventListener(NEW_CALL_EVENT, picked);
  const call = createEntries(providers).find((entry) => entry.type === "call")!;
  await runCreateEntry(call, { rpc: { call: vi.fn() }, projectId: null });
  window.removeEventListener(NEW_CALL_EVENT, picked);
  expect(picked).toHaveBeenCalledOnce();
});

it("hands a thread's own maker only the kinds made by RPC", async () => {
  const createKind = vi.fn();
  const entries = createEntries(providers);
  const rpc = { call: vi.fn() };
  await runCreateEntry(entries.find((entry) => entry.label === "Page")!, { rpc, projectId: "p1", createKind });
  expect(createKind).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "pages", label: "Page" }));
  const handled = vi.fn((event: Event) => event.preventDefault());
  window.addEventListener("talk:new", handled);
  await runCreateEntry(entries.find((entry) => entry.label === "Recording")!, { rpc, projectId: "p1", createKind });
  window.removeEventListener("talk:new", handled);
  expect(handled).toHaveBeenCalledOnce();
  expect(createKind).toHaveBeenCalledOnce();
  expect(rpc.call).not.toHaveBeenCalled();
});

describe("newItemProject", () => {
  const projects = [{ id: "proj_orbit", name: "Orbit" }, { id: "proj_atlas", name: "Atlas" }];
  it("uses the project BB has open, whatever the library filters", () => {
    expect(newItemProject("proj_open", "project:Orbit", projects)).toBe("proj_open");
  });
  it("falls back to the library's Project filter when no project is open", () => {
    expect(newItemProject(null, "project:Orbit kind:page", projects)).toBe("proj_orbit");
    expect(newItemProject(undefined, "project:proj_atlas", projects)).toBe("proj_atlas");
  });
  it("is Global when nothing picks one project", () => {
    expect(newItemProject(null, "", projects)).toBeNull();
    expect(newItemProject(null, "project:Orbit project:Atlas", projects)).toBeNull();
    expect(newItemProject(null, "project:global", projects)).toBeNull();
    expect(newItemProject(null, "-project:Orbit", projects)).toBeNull();
  });
});
