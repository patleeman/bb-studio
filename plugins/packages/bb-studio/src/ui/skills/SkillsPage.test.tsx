// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { MIGRATIONS } from "../../migrations";
import { Bots } from "../../bot";

const store = vi.hoisted(() => ({ bots: null as null | import("../../bot").Bots, rerender: () => {} }));
vi.mock("../live", () => {
  const read = (method: string, input: Record<string, unknown>) => {
    const bots = store.bots!;
    const botId = input.botId as string | undefined;
    if (method === "bot_spaces") return { bots: [{ id: "bot_main", name: "Dot" }, { id: "bot_two", name: "Scout" }], currentBotId: "bot_main" };
    if (method === "bot_skills") return { skills: bots.skills(botId) };
    if (method === "bot_skill_history") return { versions: bots.skillHistory(botId, input.before as number | undefined, input.name as string | undefined) };
    throw new Error(`unexpected ${method}`);
  };
  const call = async (method: string, input: Record<string, unknown>) => {
    const bots = store.bots!;
    const botId = input.botId as string;
    if (method === "bot_skill_delete") return { deleted: bots.deleteSkill(input.name as string, botId) };
    if (method === "bot_skill_restore") return { changed: bots.setSkillState(input.name as string, "active", botId) };
    if (method === "bot_skill_revert") { bots.revertSkill(input.versionId as number, botId); return { reverted: true }; }
    throw new Error(`unexpected ${method}`);
  };
  return {
    useCall: () => call,
    useLive: (method: string, input: Record<string, unknown>, options: { enabled?: boolean } = {}) => ({ data: options.enabled === false ? null : read(method, input), error: null, loading: false, refresh: () => {} }),
  };
});
vi.mock("../../kit/ui/icon", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));
vi.mock("../../kit/app/index", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} />, openAppPath: vi.fn(), StudioBar: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));
vi.mock("../../kit/app/host-sdk", async (original) => ({ ...(await original<object>()), useHostTabWindow: () => null }));

const { default: SkillsPage } = await import("./SkillsPage");

let root: Root, container: HTMLDivElement, dispose: () => Promise<void>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("confirm", () => true);
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  dispose = () => harness.lifecycle.dispose();
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  for (const [id, name, at] of [["bot_main", "Dot", 1], ["bot_two", "Scout", 2]] as const) {
    db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES (?, ?, '🟣', 'active', NULL, 0, ?, ?)").run(id, name, at, at);
  }
  store.bots = new Bots({ db, sdk: bb.sdk, leads: null as never, changed: () => {}, presenceChanged: () => {}, memory: { exists: () => false, create: () => "pg" } as never, userSkillsDir: "/nonexistent" } as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); await dispose(); });

const render = (node: ReactNode) => act(() => root.render(node));
const qa = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const click = (element: Element | null | undefined) => act(async () => { (element as HTMLElement).click(); });
const names = () => qa("[data-testid=skill-row]").map((row) => row.dataset.skill);
const pill = (value: string) => container.querySelector(`[data-testid=bot-page-pill][data-value=${value}]`);

it("lists only the Bot's own skills, archived apart, in the Bot-page template", () => {
  const bots = store.bots!;
  bots.writeSkill({ name: "deploy-check", description: "Before a release", body: "Run the smoke tests." }, "bot_main");
  bots.writeSkill({ name: "inbox-sweep", description: "Sort mail", body: "b" }, "bot_main");
  bots.writeSkill({ name: "old-report", description: "Monthly report", body: "b" }, "bot_main");
  bots.setSkillState("old-report", "archived", "bot_main");
  bots.writeSkill({ name: "release-watch", description: "Scout's", body: "b" }, "bot_two");
  render(<SkillsPage botId="bot_main" />);
  expect(container.querySelector("[data-testid=skills-page]")?.getAttribute("data-bot-page")).toBe("Skills");
  expect(container.querySelector("[data-testid=page-bar]")?.textContent).toContain("Dot");
  expect(names()).toEqual(["deploy-check", "inbox-sweep"]);
  expect(pill("skills")?.textContent).toBe("Skills2");
  expect(pill("archived")?.textContent).toBe("Archived1");
  render(<SkillsPage botId="bot_two" />);
  expect(names()).toEqual(["release-watch"]);
});

it("opens a skill to its body and history with diffs, and reverts a version", async () => {
  const bots = store.bots!;
  bots.writeSkill({ name: "deploy-check", description: "Before a release", body: "v1" }, "bot_main");
  bots.writeSkill({ name: "deploy-check", description: "Before a release", body: "v2" }, "bot_main");
  render(<SkillsPage botId="bot_main" />);
  await click(container.querySelector("[data-testid=skill-row] [data-testid=bot-page-row-open]"));
  expect(container.querySelector("[data-testid=skill-body]")?.textContent).toBe("v2");
  const versions = qa("[data-testid=skill-detail] [data-testid=skill-version]");
  expect(versions).toHaveLength(2);
  await click(versions[0]!.querySelector("[data-testid=bot-page-row-open]"));
  expect(container.querySelector("[data-testid=skill-diff]")?.textContent).toBe("- v1\n+ v2");
  await click(versions[1]!.querySelector("[data-testid=skill-revert]"));
  expect(bots.skill("deploy-check", "bot_main")?.body).toBe("v1");
  expect(container.querySelector("[data-testid=skill-body]")?.textContent).toBe("v1");
  expect(qa("[data-testid=skill-detail] [data-testid=skill-version]")).toHaveLength(3);
});

it("deletes a skill, shows the delete in History, and brings it back with Revert", async () => {
  const bots = store.bots!;
  bots.writeSkill({ name: "inbox-sweep", description: "Sort mail", body: "Steps" }, "bot_main");
  render(<SkillsPage botId="bot_main" />);
  await click(container.querySelector("[data-testid=skill-delete]"));
  expect(bots.skill("inbox-sweep", "bot_main")).toBeNull();
  expect(names()).toEqual([]);
  expect(container.querySelector("[data-testid=skills-empty]")?.textContent).toBe("No skills");
  await click(pill("history"));
  const history = qa("[data-testid=skills-history] [data-testid=skill-version]");
  expect(history.map((row) => row.querySelector("[data-testid=bot-page-row-status]")?.textContent ?? "")).toEqual(["Deleted", ""]);
  await click(history[1]!.querySelector("[data-testid=skill-revert]"));
  expect(bots.skill("inbox-sweep", "bot_main")?.body).toBe("Steps");
  await click(pill("skills"));
  expect(names()).toEqual(["inbox-sweep"]);
});

it("restores an archived skill and filters by search", async () => {
  const bots = store.bots!;
  bots.writeSkill({ name: "deploy-check", description: "Before a release", body: "b" }, "bot_main");
  bots.writeSkill({ name: "old-report", description: "Monthly report", body: "b" }, "bot_main");
  bots.setSkillState("old-report", "archived", "bot_main");
  render(<SkillsPage botId="bot_main" />);
  const search = container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "release"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(names()).toEqual(["deploy-check"]);
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, ""); search.dispatchEvent(new Event("input", { bubbles: true })); });
  await click(pill("archived"));
  expect(names()).toEqual(["old-report"]);
  await click(container.querySelector("[data-testid=skill-restore]"));
  expect(bots.skill("old-report", "bot_main")?.state).toBe("active");
});
