import { expect, it } from "vitest";
import { hideBbSkills } from "./hide-bb-skills";
import { pathFor, refOfPath, tabOpenFor } from "../../tab-kinds";
import { skillsBotFromPath, skillsPagePath } from "./paths";

it("hides bb's Skills row, Skills page and CLI skills settings on a BB that can", () => {
  const registered: unknown[] = [];
  const slots = { experimental_hideHostEntries(registration: unknown) { registered.push(registration); } };
  expect(hideBbSkills(slots)).toBe(true);
  expect(registered).toEqual([{ id: "bb-skills", navigation: ["__bb__/skills"], pages: ["skills"], settings: ["cli-skills"] }]);
  expect(hideBbSkills({})).toBe(false);
});

it("addresses each Bot's Skills page as a Bot page", () => {
  expect(skillsPagePath("bot_main")).toBe("skills/bot_main");
  expect(skillsBotFromPath("skills/bot%20two")).toBe("bot two");
  expect(skillsBotFromPath("skills")).toBeNull();
  expect(pathFor({ kind: "skills", id: "bot_main" })).toBe("/plugins/studio/studio/skills/bot_main");
  expect(refOfPath("/plugins/studio/studio/skills/bot_main")).toEqual({ kind: "skills", id: "bot_main" });
  expect(tabOpenFor({ kind: "skills", id: "bot_main" })).toMatchObject({ tabId: "bot-skills", params: { botId: "bot_main" }, title: "Skills" });
});
