import { describe, expect, it } from "vitest";
import { arrange, type SidebarSectionInfo } from "./sidebar-registry";

const section = (key: string, order: number): SidebarSectionInfo => ({ key, pluginId: key.split(":")[0]!, id: key.split(":")[1]!, title: key, order });
const keys = (list: readonly SidebarSectionInfo[]) => list.map((each) => each.key);

describe("sidebar sections", () => {
  const all = [section("bot-teams:direct", 20), section("studio:tabs", 0), section("studio:spaces", 10)];

  it("go by default order until the user places them", () => {
    expect(keys(arrange(all, { order: [], hidden: [] }).visible)).toEqual(["studio:tabs", "studio:spaces", "bot-teams:direct"]);
  });

  it("keep the user's order, and hide what they hid", () => {
    const result = arrange(all, { order: ["bot-teams:direct", "studio:tabs", "studio:spaces"], hidden: ["studio:tabs"] });
    expect(keys(result.visible)).toEqual(["bot-teams:direct", "studio:spaces"]);
    expect(keys(result.hidden)).toEqual(["studio:tabs"]);
  });

  it("slot a newly installed app in by its default order", () => {
    const withNew = [...all, section("chat:recent", 15)];
    const result = arrange(withNew, { order: ["studio:spaces", "studio:tabs", "bot-teams:direct"], hidden: [] });
    expect(keys(result.visible)).toEqual(["studio:spaces", "studio:tabs", "chat:recent", "bot-teams:direct"]);
  });
});
