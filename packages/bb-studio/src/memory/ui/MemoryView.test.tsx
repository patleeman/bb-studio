// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { MIGRATIONS } from "../../migrations";
import { Bots } from "../../bot";
import { CORE_TEMPLATE } from "../../core-skill";

const SUMMARY = "**Decisions**\n- Ship on Friday.\n\n**Left open**\n- Who writes the post?\n\n**Made**\n- The launch page.";
const store = vi.hoisted(() => ({ bots: null as null | import("../../bot").Bots, learning: { enabled: true }, calls: [] as [string, Record<string, unknown>][], searched: [] as string[], coreReads: 0, beforeWrite: null as null | (() => void), frozenCore: null as unknown, fresh: false }));
vi.mock("../../ui/live", () => {
  const read = (method: string, input: Record<string, unknown>) => {
    const bots = store.bots!;
    const botId = input.botId as string;
    if (method === "bot_spaces") return { bots: [{ id: "bot_main", name: "Dot" }], currentBotId: "bot_main" };
    if (method === "bot_core" && store.frozenCore && !store.fresh) return store.frozenCore;
    if (method === "bot_core") { store.coreReads++; return { skills: bots.alwaysOnSkills(botId).map((skill) => ({ ...skill, warnings: bots.skillLint({ ...skill, alwaysOn: true }, botId) })), ...bots.skillBudget(botId) }; }
    if (method === "bot_skills") return { skills: bots.skills(botId) };
    if (method === "bot_skill_history") return { versions: bots.skillHistory(botId, input.before as number | undefined, input.name as string | undefined) };
    if (method === "bot_learning") return { ...store.learning, reviewing: false, queued: 0, cadence: "daily-and-archive", lastSweepAt: null, lastReview: { at: Date.now() - 3_600_000, result: "Saved 1 skill" }, lastCurator: null, reviewModel: null, defaultModel: null, models: [], consolidate: false };
    if (method === "bot_summaries") return { botId, summaries: [{ threadId: "thr_launch", title: "Launch prep", archivedAt: Date.UTC(2026, 10, 20), summary: SUMMARY }, { threadId: "thr_trip", title: "Lisbon trip", archivedAt: Date.UTC(2026, 10, 18), summary: "**Decisions**\n- Train, not plane." }] };
    if (method === "bot_conversations_all") return { botId, conversations: [{ threadId: "thr_main", title: "Main", isMain: true, forkedFrom: null, projectId: null, updatedAt: Date.now(), archivedAt: null, summary: null, latest: "Morning.", running: false, needsYou: null, failed: false }], workers: [] };
    if (method === "bot_conversations_search") { store.searched.push(input.query as string); return { hits: [], indexing: false }; }
    throw new Error(`unexpected ${method}`);
  };
  const call = async (method: string, input: Record<string, unknown>) => {
    store.calls.push([method, input]);
    const bots = store.bots!;
    if (method === "bot_skill_write") { const before = store.beforeWrite; store.beforeWrite = null; before?.(); return bots.writeSkill(input as never, input.botId as string); }
    if (method === "bot_core") { store.fresh = true; try { return read(method, input); } finally { store.fresh = false; } }
    if (method === "bot_learning_set") { store.learning = { enabled: input.enabled as boolean }; return {}; }
    if (method === "bot_learning_review") return { started: true };
    throw new Error(`unexpected ${method}`);
  };
  return {
    useCall: () => call,
    useLive: (method: string, input: Record<string, unknown>, options: { enabled?: boolean } = {}) => ({ data: options.enabled === false ? null : read(method, input), error: null, loading: false, refresh: () => {} }),
  };
});
const opened = vi.hoisted(() => [] as string[]);
vi.mock("../../ui/bot-page/open-row", async (original) => ({
  ...(await original<object>()),
  useRowOpen: () => (target: { kind: string; id: string }) => ({ link: `bb://${target.kind}/${target.id}`, selected: false, dragItem: null, onOpen: () => { opened.push(target.id); } }),
}));
vi.mock("../../kit/ui/icon", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));
vi.mock("../../kit/app/index", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} />, openAppPath: vi.fn(), StudioBar: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));
vi.mock("../../kit/app/host-sdk", async (original) => ({ ...(await original<object>()), useHostTabWindow: () => null }));

const { default: MemoryView, coreSections } = await import("./MemoryView");

let root: Root, container: HTMLDivElement, dispose: () => Promise<void>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  dispose = () => harness.lifecycle.dispose();
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES ('bot_main', 'Dot', '🟣', 'active', NULL, 0, 1, 1)").run();
  store.bots = new Bots({ db, sdk: bb.sdk, leads: null as never, changed: () => {}, presenceChanged: () => {}, memory: { exists: () => false }, userSkillsDir: "/nonexistent" } as never);
  store.calls = [];
  store.searched = [];
  store.learning = { enabled: true };
  store.frozenCore = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); await dispose(); });

const render = (node: ReactNode) => act(() => root.render(node));
const $ = (selector: string) => container.querySelector<HTMLElement>(selector);
const qa = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const click = (element: Element | null | undefined) => act(async () => { (element as HTMLElement).click(); });
const type = (element: HTMLTextAreaElement | HTMLInputElement, value: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
});

it("shows three layers: Core with its budget and sections, Skills with Auto-learn, History with Summaries first", () => {
  store.bots!.writeSkill({ name: "deploy-check", description: "Before a release", body: "Run the smoke tests." }, "bot_main");
  render(<MemoryView botId="bot_main" />);
  expect($("[data-testid=memory-view]")?.getAttribute("data-bot-page")).toBe("Memory");
  expect(qa("[data-testid=bot-page-group] > * h2, [data-testid=memory-core], [data-testid=memory-skills], [data-testid=memory-history]").map((each) => each.dataset.testid)).toEqual(["memory-core", "memory-skills", "memory-history"]);
  expect($("[data-testid=memory-budget]")?.textContent).toBe(`${CORE_TEMPLATE.trim().length} / 2,000 chars`);
  expect(qa("[data-testid=memory-core-section]").map((each) => each.dataset.section)).toEqual(["Preferences", "Right now", "Check-in"]);
  expect(qa("[data-testid=memory-section-lines]").map((each) => each.textContent)).toEqual(["0 / 25", "0 / 10"]);
  // The core skill is Core's, not a row among the on-demand skills.
  expect(qa("[data-testid=memory-skill]").map((row) => row.dataset.skill)).toEqual(["deploy-check"]);
  expect($("[data-testid=memory-autolearn]")?.textContent).toMatch(/Auto-learn.*Daily \+ on archive.*Saved 1 skill/);
  expect(qa("[data-testid=memory-summary]").map((card) => card.dataset.threadId)).toEqual(["thr_launch", "thr_trip"]);
  expect($("[data-testid=memory-summary]")?.textContent).toMatch(/Launch prep.*Decisions.*Ship on Friday.*Left open.*Made.*The launch page/);
});

it("opens the conversation from its summary card", async () => {
  render(<MemoryView botId="bot_main" />);
  await click($("[data-testid=memory-summary] button"));
  expect(opened.at(-1)).toBe("thr_launch");
});

it("edits a Core section in place and saves it into the always-on skill", async () => {
  render(<MemoryView botId="bot_main" />);
  const section = qa("[data-testid=memory-core-section]").find((each) => each.dataset.section === "Preferences")!;
  await click(section.querySelector("[data-testid=memory-section-edit]"));
  type($("[data-testid=memory-section-input]") as HTMLTextAreaElement, "- Give one clear recommendation.");
  await click($("[data-testid=memory-section-save]"));
  expect(store.calls.filter(([method]) => method === "bot_skill_write")).toEqual([["bot_skill_write", expect.objectContaining({ botId: "bot_main", name: "core-profile" })]]);
  const body = store.bots!.skill("core-profile", "bot_main")!.body;
  expect(body).toContain("## Preferences\n\n- Give one clear recommendation.\n\n## Right now");
  expect(store.bots!.skill("core-profile", "bot_main")!.alwaysOn).toBe(true);
});

it("keeps an open draft through a refresh, and saves into the latest text: the Bot's edit to another section stays", async () => {
  render(<MemoryView botId="bot_main" />);
  const prefs = () => qa("[data-testid=memory-core-section]").find((each) => each.dataset.section === "Preferences")!;
  await click(prefs().querySelector("[data-testid=memory-section-edit]"));
  type($("[data-testid=memory-section-input]") as HTMLTextAreaElement, "- Short answers.");
  // Meanwhile the Bot patches Right now, and the 30 s poll re-renders with it.
  const bots = store.bots!;
  const core = bots.skill("core-profile", "bot_main")!;
  bots.writeSkill({ name: "core-profile", description: core.description, body: core.body.replace("## Right now\n", "## Right now\n\n- Travelling this week.\n") }, "bot_main");
  render(<MemoryView botId="bot_main" />);
  expect(($("[data-testid=memory-section-input]") as HTMLTextAreaElement).value).toBe("- Short answers.");
  await click($("[data-testid=memory-section-save]"));
  const body = bots.skill("core-profile", "bot_main")!.body;
  expect(body).toContain("## Preferences\n\n- Short answers.");
  expect(body).toContain("## Right now\n\n- Travelling this week.");
});

it("flags a conflict when the same section changed while you edited; saving again replaces it", async () => {
  render(<MemoryView botId="bot_main" />);
  const checkin = () => qa("[data-testid=memory-core-section]").find((each) => each.dataset.section === "Check-in")!;
  await click(checkin().querySelector("[data-testid=memory-section-edit]"));
  type($("[data-testid=memory-section-input]") as HTMLTextAreaElement, "- Mine.");
  const bots = store.bots!;
  bots.addCheckin("bot_main", "Theirs: the Bot's new line.");
  await click($("[data-testid=memory-section-save]"));
  expect($("[data-testid=memory-section-conflict]")?.textContent).toContain("Theirs: the Bot's new line.");
  expect(bots.skill("core-profile", "bot_main")!.body).toContain("Theirs: the Bot's new line.");
  expect($("[data-testid=memory-section-save]")?.textContent).toBe("Replace");
  await click($("[data-testid=memory-section-save]"));
  expect(bots.skill("core-profile", "bot_main")!.body).toContain("## Check-in\n\n- Mine.");
  expect(bots.skill("core-profile", "bot_main")!.body).not.toContain("Theirs");
});

it("writes with ifBody, so an edit between the read and the write becomes a conflict, not an overwrite", async () => {
  render(<MemoryView botId="bot_main" />);
  const prefs = qa("[data-testid=memory-core-section]").find((each) => each.dataset.section === "Preferences")!;
  await click(prefs.querySelector("[data-testid=memory-section-edit]"));
  type($("[data-testid=memory-section-input]") as HTMLTextAreaElement, "- Mine.");
  // The Bot writes the same section right after the page's re-read: the compare-and-swap refuses.
  store.beforeWrite = () => { const core = store.bots!.skill("core-profile", "bot_main")!; store.bots!.writeSkill({ name: "core-profile", description: core.description, body: core.body.replace("## Preferences\n", "## Preferences\n\n- Theirs.\n") }, "bot_main"); };
  await click($("[data-testid=memory-section-save]"));
  expect(store.calls.find(([method]) => method === "bot_skill_write")?.[1]).toMatchObject({ ifBody: expect.any(String) });
  expect($("[data-testid=memory-section-conflict]")?.textContent).toContain("- Theirs.");
  expect(store.bots!.skill("core-profile", "bot_main")!.body).not.toContain("- Mine.");
});

it("reopens a section after a save with the saved text, before the poll catches up", async () => {
  render(<MemoryView botId="bot_main" />);
  const prefs = () => qa("[data-testid=memory-core-section]").find((each) => each.dataset.section === "Preferences")!;
  // The page's data stays as it was (no poll yet); the page's own reads see the store.
  store.bots!.alwaysOnSkills("bot_main");
  store.frozenCore = { skills: store.bots!.alwaysOnSkills("bot_main").map((skill) => ({ ...skill, warnings: [] })), chars: 0, cap: 2000, over: false };
  render(<MemoryView botId="bot_main" />);
  await click(prefs().querySelector("[data-testid=memory-section-edit]"));
  type($("[data-testid=memory-section-input]") as HTMLTextAreaElement, "- Saved line.");
  await click($("[data-testid=memory-section-save]"));
  await click(prefs().querySelector("[data-testid=memory-section-edit]"));
  expect(($("[data-testid=memory-section-input]") as HTMLTextAreaElement).value).toBe("- Saved line.");
});

it("shows every always-on skill when the core skill is gone, instead of 'No always-on skill'", () => {
  const bots = store.bots!;
  bots.ensureCore("bot_main");
  bots.writeSkill({ name: "travel-rules", description: "Always on", body: "## Preferences\n\n- Aisle seats.\n", alwaysOn: true }, "bot_main");
  bots.writeSkill({ name: "home-rules", description: "Always on", body: "- Quiet after 9.\n", alwaysOn: true }, "bot_main");
  bots.deleteSkill("core-profile", "bot_main");
  render(<MemoryView botId="bot_main" />);
  expect($("[data-testid=memory-core-empty]")).toBeNull();
  expect(qa("[data-testid=memory-core-section]").map((each) => each.dataset.section)).toEqual(["home-rules", "travel-rules"]);
});

it("adds a skill, toggles Auto-learn and runs it now", async () => {
  render(<MemoryView botId="bot_main" />);
  await click($("[data-testid=memory-skill-new]"));
  const form = $("[data-testid=memory-skill-form]")!;
  const [name, description] = [...form.querySelectorAll("input")];
  type(name!, "weekly-review");
  type(description!, "When the week ends");
  type(form.querySelector("textarea")!, "1. Read the week.");
  await click(form.querySelector("button[type=submit]"));
  expect(store.bots!.skill("weekly-review", "bot_main")).toMatchObject({ description: "When the week ends", alwaysOn: false });
  await click($("[data-testid=memory-autolearn-run]"));
  expect(store.calls.some(([method]) => method === "bot_learning_review")).toBe(true);
  await click($("[data-testid=memory-autolearn] [role=switch]"));
  expect(store.calls.find(([method]) => method === "bot_learning_set")?.[1]).toEqual({ botId: "bot_main", enabled: false });
});

it("searches summaries, and switches to past conversations with full-text search", async () => {
  render(<MemoryView botId="bot_main" />);
  type($("[data-testid=memory-history-search]") as HTMLInputElement, "train");
  expect(qa("[data-testid=memory-summary]").map((card) => card.dataset.threadId)).toEqual(["thr_trip"]);
  await click(qa("[data-testid=memory-history-view] button").find((each) => each.textContent === "Past conversations"));
  expect($("[data-testid=memory-summary]")).toBeNull();
  expect(qa("[data-testid=memory-conversation]").length + qa("[data-testid=memory-conversations-empty]").length).toBe(1);
});

it("orders the core sections: the three defaults, then any others the moved profile has", () => {
  expect(coreSections("## Who the user is\n\nSam.\n\n## Check-ins\n\n- Inbox.").map((each) => [each.heading, each.text, each.missing])).toEqual([
    ["Preferences", "", true], ["Right now", "", true], ["Check-ins", "- Inbox.", false], ["Who the user is", "Sam.", false],
  ]);
});
