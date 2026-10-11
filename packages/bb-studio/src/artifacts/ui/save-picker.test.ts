// @vitest-environment jsdom
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => ({ call: async () => ({}) }), useRealtime: () => {}, experimental_Icon: () => null, experimental_usePluginId: () => "artifacts" }));
vi.mock("./artifact-viewer", () => ({ ArtifactViewer: ({ artifactId }: { artifactId: string }) => createElement("p", null, `viewing ${artifactId}`) }));
import { SavePicker } from "./save-picker";

it("shows the artifact its tab asks for when BB reuses the panel", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const panel = (artifactId: string) => createElement(SavePicker, { threadId: "thr_1", params: { artifactId } } as never);
  await act(() => root.render(panel("art_bossbossbossboss")));
  expect(host.textContent).toBe("viewing art_bossbossbossboss");
  await act(() => root.render(panel("art_fanfarefanfare00")));
  expect(host.textContent).toBe("viewing art_fanfarefanfare00");
  act(() => root.unmount());
});
