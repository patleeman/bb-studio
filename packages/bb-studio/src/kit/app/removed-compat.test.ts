// @vitest-environment jsdom
import { expect, it } from "vitest";
import * as app from "./index";
import * as workspaceState from "../../ui/workspace-state";

it("does not expose retired thread-panel and workspace-filter helpers", () => {
  expect("ThreadItemsPanel" in app).toBe(false);
  expect("isOwnPageTool" in workspaceState).toBe(false);
});
