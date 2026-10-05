// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { composerPendingKey, composerSource, registerComposerSource } from "./composer-source";

afterEach(() => { document.body.innerHTML = ""; });
const main = { threadId: "thr_main", projectId: "proj_main" };
function prompt() {
  const parent = document.createElement("div"), element = document.createElement("div");
  parent.append(element); document.body.append(parent); return element;
}

it("keeps a new-thread draft on its page and uses its selected project", () => {
  const element = prompt();
  registerComposerSource(element, () => ({ kind: "new-thread", projectId: "proj_selected" }));
  const source = composerSource(element, main);
  expect(source).toEqual({ threadId: null, projectId: "proj_selected", path: location.pathname });
  expect(composerPendingKey({ ...source, path: "/plugins/pages/pages/pg_1" })).toBe("compose:/plugins/pages/pages/pg_1");
});

it("reads the latest SDK scope when a main composer is reused, and unregisters it", () => {
  const element = prompt(); let threadId = "thr_a";
  const unregister = registerComposerSource(element, () => ({ kind: "thread", threadId }));
  expect(composerSource(element, main).threadId).toBe("thr_a");
  threadId = "thr_b"; expect(composerSource(element, main).threadId).toBe("thr_b");
  unregister(); expect(composerSource(element, main).threadId).toBe("thr_main");
});
