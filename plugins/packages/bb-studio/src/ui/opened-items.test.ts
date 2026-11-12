import { afterEach, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_useAppPanel: () => null, useBbNavigate: () => ({}) }));
vi.mock("../kit/app/nav", () => ({ openAppPath: vi.fn(), openAppPathInSplit: () => false }));
vi.mock("../kit/app/workspace", () => ({ openWorkspaceItem: () => true }));

const { noteOpened, setOpenedRecorder } = await import("./opened-items");
const { planOpen, runPlan } = await import("./studio-open");
const { paletteQuery } = await import("./palette-search");

let stop = () => {};
afterEach(() => stop());

const PAGE = "/plugins/studio/studio/pages/pg_1";
const navigate = { toThread: vi.fn(), openUrl: () => true };

it("records an item opened in a thread's workbench, in Studio, or in the main view, and nothing else", () => {
  const seen: string[] = [];
  stop = setOpenedRecorder(async (path) => { seen.push(path); return null; });
  const panel = { openTab: () => true };
  runPlan(planOpen({ href: PAGE, title: "Plan" }, { kind: "thread", threadId: "thr_1" }), { panel, navigate });
  runPlan(planOpen({ href: PAGE }, { kind: "studio" }), { panel, navigate });
  runPlan(planOpen({ href: "/plugins/studio/bot" }, null), { panel, navigate });
  runPlan(planOpen({ threadId: "thr_2" }, null), { panel, navigate });
  runPlan(planOpen({ url: "https://example.com" }, null), { panel, navigate });
  expect(seen).toEqual([PAGE, PAGE, "/plugins/studio/bot"]);
});

it("opens in the main view or the workbench when the caller names the place", () => {
  const thread = { kind: "thread" as const, threadId: "thr_1" };
  // The sidebar and search: the main view, even from a thread.
  expect(planOpen({ href: PAGE }, thread, { target: "main" })).toEqual({ via: "main", href: PAGE });
  // Mod-click from a thread: that thread's workbench; with no thread, Studio's tabs (the Global workbench in the fork).
  expect(planOpen({ href: PAGE }, thread, { target: "workbench" })).toMatchObject({ via: "workbench", threadId: "thr_1" });
  expect(planOpen({ href: PAGE }, null, { target: "workbench" })).toEqual({ via: "studio", href: PAGE, placement: "tab" });
  expect(planOpen({ href: PAGE }, { kind: "studio" }, { target: "workbench" })).toEqual({ via: "studio", href: PAGE, placement: "tab" });
});

it("never lets a failing recorder break an open, and ignores non-paths", async () => {
  const record = vi.fn(async (): Promise<string | null> => { throw new Error("offline"); });
  stop = setOpenedRecorder(record);
  await expect(noteOpened(PAGE)).resolves.toBeNull();
  await expect(noteOpened("https://example.com")).resolves.toBeNull();
  await expect(noteOpened(null)).resolves.toBeNull();
  expect(record).toHaveBeenCalledTimes(1);
});

it("names a workbench tab for its item when the opener gave no title", async () => {
  stop = setOpenedRecorder(async () => "Launch plan");
  const openTab = vi.fn(() => true);
  runPlan(planOpen({ href: PAGE }, { kind: "thread", threadId: "thr_1" }), { panel: { openTab }, navigate });
  expect(openTab).not.toHaveBeenCalled();
  await Promise.resolve();
  await Promise.resolve();
  expect(openTab).toHaveBeenCalledTimes(1);
  expect(openTab.mock.calls[0]).toMatchObject([{ title: "Launch plan" }]);
});

it("filters the palette by type with a prefix, and leaves other colons alone", () => {
  expect(paletteQuery("page: plan")).toEqual({ query: "plan", kinds: ["page"] });
  expect(paletteQuery("Boards:roadmap")).toEqual({ query: "roadmap", kinds: ["drawing"] });
  expect(paletteQuery("app:")).toEqual({ query: "", kinds: ["mini"] });
  expect(paletteQuery("todo: ship it")).toEqual({ query: "todo: ship it" });
});
