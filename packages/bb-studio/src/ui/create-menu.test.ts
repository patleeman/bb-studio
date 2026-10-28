// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ProviderView } from "../contract";
import { NEW_CALL_EVENT } from "../talk/shared/format";
import { createEntries, runCreateEntry, startsGroup } from "./create-menu";

const kind = (id: string, label: string, extra: Record<string, unknown> = {}) => ({ id, label, plural: `${label}s`, icon: "File", columns: [], actions: [], create: { mode: "rpc" as const }, canArchive: true, blurb: "", ...extra });
const provider = (pluginId: string, kinds: ReturnType<typeof kind>[], state = "ready") => ({ pluginId, name: pluginId, state, detail: null, panel: null, kinds }) as unknown as ProviderView;
const providers = [
  provider("design", [kind("design", "Design")]),
  provider("talk", [kind("recording", "Recording", { create: { mode: "event", event: "talk:new" } }), kind("dictation", "Dictation", { create: null })]),
  provider("pages", [kind("page", "Page")]),
  provider("draw", [kind("drawing", "Drawing"), kind("sketch", "Sketch", { capabilities: { create: false } })]),
  provider("notion", [kind("notion-page", "Notion page")], "offline"),
];
const labels = (entries: ReturnType<typeof createEntries>) => entries.map((entry) => entry.label);

afterEach(() => vi.restoreAllMocks());

it("lists the kinds Studio can make in Studio's order, then Record a call, then templates", () => {
  const entries = createEntries(providers, { templates: [{ pluginId: "pages", id: "pg_t", title: "Weekly" }] });
  expect(labels(entries)).toEqual(["Page", "Drawing", "Recording", "Design", "Record a call", "From template: Weekly"]);
  expect(entries.map((_, index) => startsGroup(entries, index))).toEqual([false, false, false, false, true, false]);
});

it("drops what Setup → Kinds turned off, and Record a call with recordings", () => {
  expect(labels(createEntries(providers, { off: new Set(["recording", "design"]) }))).toEqual(["Page", "Drawing"]);
  expect(labels(createEntries(providers.filter((each) => each.pluginId !== "talk")))).not.toContain("Record a call");
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
