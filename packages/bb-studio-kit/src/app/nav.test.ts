import { expect, it } from "vitest";
import { panelHref } from "./nav";

it("gives encoded and decoded routes the same identity", () => {
  const ref = JSON.stringify({ pluginId: "pages", id: "pg_release" });
  const expected = `/plugins/studio-chat/chats/item/${encodeURIComponent(ref)}`;
  expect(panelHref("studio-chat", "chats", `item/${ref}`)).toBe(expected);
  expect(panelHref("studio-chat", "chats", `item/${encodeURIComponent(ref)}`)).toBe(expected);
});

it("preserves subpath boundaries, encoded reserved characters and malformed percent literals", () => {
  expect(panelHref("studio", "studio")).toBe("/plugins/studio/studio");
  expect(panelHref("pages", "pages", "Release notes/100% ready")).toBe("/plugins/pages/pages/Release%20notes/100%25%20ready");
  expect(panelHref("pages", "pages", "folder/a%2Fb%3Fc%23d")).toBe("/plugins/pages/pages/folder/a%2Fb%3Fc%23d");
});
