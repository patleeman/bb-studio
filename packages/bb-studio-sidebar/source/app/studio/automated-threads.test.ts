import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../testing/fixtures.js";
import {
  automatedModeFor,
  automatedThreadIds,
  automatedThreadKinds,
  createSectionKeyResolver,
  filterAutomatedThreads,
  hasAutomatedUpdate,
} from "./automated-threads.js";
import type { SidebarThread } from "../model/sidebar-thread.js";

const quiet = { isUnread: false, status: "idle" as const };

function filter(threads: SidebarThread[], modes: Record<string, "all" | "updates" | "hidden">, options: { revealed?: string[]; keep?: string[] } = {}) {
  const kinds = automatedThreadKinds(threads, new Set(), new Set());
  return filterAutomatedThreads({
    threads,
    automatedIds: automatedThreadIds(threads, kinds),
    sectionKeyOf: createSectionKeyResolver(threads, { mode: "project", personalProjectId: "proj_personal", spaceOf: {}, spaceIds: new Set() }),
    modeFor: (key) => automatedModeFor(modes, key),
    revealed: new Set(options.revealed),
    keepIds: new Set(options.keep),
  });
}

describe("automated threads", () => {
  it("marks attached and spawned threads, preferring the automation mark", () => {
    const rows = [
      makeSidebarThread({ id: "bot", originPluginId: "bot-teams" }),
      makeSidebarThread({ id: "run", originPluginId: "automations" }),
      makeSidebarThread({ id: "both" }),
      makeSidebarThread({ id: "plain" }),
    ];
    expect(automatedThreadKinds(rows, new Set(["both"]), new Set(["both"]))).toEqual(new Map([["bot", "bot"], ["run", "automation"], ["both", "automation"]]));
  });

  it("covers children but never pinned trees", () => {
    const rows = [
      makeSidebarThread({ id: "run", originPluginId: "automations" }),
      makeSidebarThread({ id: "child", parentThreadId: "run" }),
      makeSidebarThread({ id: "pinned", originPluginId: "automations", isPinned: true }),
      makeSidebarThread({ id: "pinned-child", parentThreadId: "pinned" }),
    ];
    expect([...automatedThreadIds(rows, automatedThreadKinds(rows, new Set(), new Set()))].sort()).toEqual(["child", "run"]);
  });

  it("counts updates: input, failed queue, unread result, running", () => {
    expect(hasAutomatedUpdate(makeSidebarThread({ ...quiet, hasPendingInteraction: true }))).toBe(true);
    expect(hasAutomatedUpdate(makeSidebarThread({ ...quiet, queuedWork: "failed" }))).toBe(true);
    expect(hasAutomatedUpdate(makeSidebarThread({ isUnread: true, status: "error" }))).toBe(true);
    expect(hasAutomatedUpdate(makeSidebarThread({ isUnread: false, status: "active" }))).toBe(true);
    expect(hasAutomatedUpdate(makeSidebarThread(quiet))).toBe(false);
  });

  it("uses the section's choice, then *, then Only with updates", () => {
    expect(automatedModeFor({ "project:a": "all", "*": "hidden" }, "project:a")).toBe("all");
    expect(automatedModeFor({ "*": "hidden" }, "project:b")).toBe("hidden");
    expect(automatedModeFor({}, "threads")).toBe("updates");
  });

  const rows = [
    makeSidebarThread({ id: "mine", projectId: "proj_app", ...quiet }),
    makeSidebarThread({ id: "read", projectId: "proj_app", originPluginId: "automations", ...quiet }),
    makeSidebarThread({ id: "parent", projectId: "proj_app", originPluginId: "bot-teams", ...quiet }),
    makeSidebarThread({ id: "unread-child", projectId: "proj_app", parentThreadId: "parent", isUnread: true, status: "idle" }),
    makeSidebarThread({ id: "loose", projectId: "proj_personal", originPluginId: "automations", ...quiet }),
  ];

  it("keeps updates with their ancestors and counts the rest per section", () => {
    const { visible, hidden } = filter(rows, {});
    expect(visible.map((row) => row.id)).toEqual(["mine", "parent", "unread-child"]);
    expect(hidden).toEqual(new Map([["project:proj_app", 1], ["threads", 1]]));
  });

  it("hides everything automated in a hidden section, and shows all in another", () => {
    const { visible, hidden } = filter(rows, { "project:proj_app": "hidden", threads: "all" });
    expect(visible.map((row) => row.id)).toEqual(["mine", "loose"]);
    expect(hidden).toEqual(new Map([["project:proj_app", 3]]));
  });

  it("reveals a section's hidden threads while keeping the count, and keeps the open thread", () => {
    const revealed = filter(rows, { "*": "hidden" }, { revealed: ["project:proj_app"] });
    expect(revealed.visible.map((row) => row.id)).toEqual(["mine", "read", "parent", "unread-child"]);
    expect(revealed.hidden.get("project:proj_app")).toBe(3);
    const kept = filter(rows, { "*": "hidden" }, { keep: ["loose"] });
    expect(kept.visible.map((row) => row.id)).toContain("loose");
    expect(kept.hidden.has("threads")).toBe(false);
  });

  it("keys sections by mode", () => {
    const thread = makeSidebarThread({ id: "t", projectId: "proj_app", sectionId: "sec_a", host: { id: "host_a", name: "A" } });
    const child = makeSidebarThread({ id: "c", projectId: "proj_web", parentThreadId: "t" });
    const all = [thread, child];
    const context = { personalProjectId: "proj_personal", spaceOf: { t: "sp_a" }, spaceIds: new Set(["sp_a"]) };
    expect(createSectionKeyResolver(all, { ...context, mode: "project" })(child)).toBe("project:proj_app");
    expect(createSectionKeyResolver(all, { ...context, mode: "chronological" })(child)).toBe("section:sec_a");
    expect(createSectionKeyResolver(all, { ...context, mode: "machine" })(thread)).toBe("machine:host_a");
    expect(createSectionKeyResolver(all, { ...context, mode: "machine" })(child)).toBe("machine:no-machine");
    expect(createSectionKeyResolver(all, { ...context, mode: "space" })(child)).toBe("space:sp_a");
  });
});
