import { expect, it } from "vitest";
import { hideBbChrome } from "./hide-bb-chrome";

it("hides bb's Mobile page, Mobile apps and Report a bug footer items and Provider usage's footer item on a BB that can", () => {
  const registered: unknown[] = [];
  const slots = { experimental_hideHostEntries(registration: unknown) { registered.push(registration); } };
  expect(hideBbChrome(slots)).toBe(true);
  expect(registered).toEqual([{ id: "bb-chrome", settingsSections: ["mobile"], footer: ["builtin:mobile", "builtin:report-bug", "plugin:bb--provider-usage/usage"] }]);
  expect(hideBbChrome({})).toBe(false);
});
