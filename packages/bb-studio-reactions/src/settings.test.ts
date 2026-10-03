import { expect, it } from "vitest";
import { menuSettings, needsMenuReload } from "./settings";
import { DEFAULT_EMOJI_ITEMS } from "./emoji-items";

it("keeps explicit empty menus while falling back to defaults for unavailable settings", () => {
  expect(menuSettings().emojiItems).toBe(DEFAULT_EMOJI_ITEMS);
  expect(menuSettings({ emojiItems: "" }).emojiItems).toBe("");
});

it("distinguishes saved menu changes from server-only smart reaction changes", () => {
  const applied = menuSettings();
  expect(needsMenuReload(applied, menuSettings({ smartReactions: true }))).toBe(false);
  expect(needsMenuReload(applied, menuSettings({ quoteSelection: false }))).toBe(true);
  expect(needsMenuReload(applied, menuSettings({ emojiItems: "✅ Go" }))).toBe(true);
  expect(needsMenuReload(applied, menuSettings({ showInSelectionMenu: false }))).toBe(true);
});
