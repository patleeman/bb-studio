import { expect, it } from "vitest";
import { hideBbChrome } from "./hide-bb-chrome";

it("hides bb's Mobile page, Mobile apps and Report a bug footer items, Provider usage's footer item and the running children above the composer on a BB that can", () => {
  const registered: unknown[] = [];
  const slots = { experimental_hideHostEntries(registration: unknown) { registered.push(registration); } };
  expect(hideBbChrome(slots)).toBe(true);
  expect(registered).toEqual([{ id: "bb-chrome", settingsSections: ["mobile"], footer: ["builtin:mobile", "builtin:report-bug", "plugin:bb--provider-usage/usage"], promptStack: ["active-child-threads"] }]);
  expect(hideBbChrome({})).toBe(false);
});
