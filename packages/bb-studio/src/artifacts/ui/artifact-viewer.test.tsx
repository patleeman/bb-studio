// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Icon: ({ name }: { name: string }) => <i data-icon={name} />,
  useRpc: () => ({ call: state.call }),
  useRealtime: () => {},
  useBbNavigate: () => ({ toThread: vi.fn() }),
  useSdk: () => ({}),
}));
vi.mock("../../kit/app/index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../kit/app/index")>()),
  ItemHeader: ({ trailing }: { trailing?: ReactNode }) => <div>{trailing}</div>,
}));
vi.mock("../../ui/studio-open", () => ({ useStudioOpen: () => vi.fn() }));
vi.mock("../../ui/app-title", () => ({ AppTitle: () => null }));
vi.mock("./artifact-body", () => ({ ArtifactBody: () => null }));
vi.mock("./artifact-quote", () => ({ QuoteCard: () => null, useSelectionPick: () => [null, () => {}] }));

const { setItemChatHost } = await import("../../kit/app/item-chat");
const { ArtifactViewer } = await import("./artifact-viewer");

const version = { id: "ver_1", number: 1, type: "html", size: 2500, name: "checklist.html", createdAt: 1 };
const artifact = { id: "art_1", title: "Packing checklist", projectId: "proj_1", sourceThreadId: "thr_1", version };

let root: Root, container: HTMLDivElement, clearHost = () => {};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.call.mockReset().mockResolvedValue({ artifact, versions: [version] });
  clearHost = setItemChatHost({
    home: () => ({ threadId: "thr_1", title: "Main", origin: "created" }),
    watch: () => {},
    open: vi.fn(),
    start: vi.fn(),
    send: vi.fn(async () => null),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); clearHost(); vi.unstubAllGlobals(); });

it("lists Open conversation once, with no linking, Convert or Move to", async () => {
  await act(async () => root.render(<ArtifactViewer artifactId="art_1" backLabel="Library" onBack={() => {}} />));
  await act(async () => {
    container.querySelector('[aria-label="More"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const entries = [...document.querySelectorAll('[role="menuitem"]')].map((element) => element.textContent?.trim());
  expect(entries).toEqual(["Copy reference", "Open conversation", "Show source", "Copy text", "Download", "Delete…"]);
});
