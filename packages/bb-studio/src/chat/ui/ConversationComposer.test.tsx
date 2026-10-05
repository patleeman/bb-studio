// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationPage } from "./ConversationComposer";
import { itemDraftPath, quoteDraftPath, quoteDrafts } from "./conversation-drafts";

const state = vi.hoisted(() => ({
  rpc: { call: vi.fn() },
  navigate: { toThread: vi.fn() },
  submit: new Map<string, (request: any) => Promise<void>>(),
  props: new Map<string, any>(),
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_usePluginId: () => "studio",
  experimental_Icon: () => null,
  useRpc: () => state.rpc,
  useBbNavigate: () => state.navigate,
  useSdk: () => ({ plugins: { callRpc: vi.fn() } }),
  experimental_useSidebarThreadActions: () => ({ open: vi.fn() }),
  experimental_NewThreadComposer: (props: any) => {
    state.props.set(props.draftKey, props);
    state.submit.set(props.draftKey, props.onSubmit);
    return <><textarea aria-label="Draft" defaultValue={props.initialPrompt} /><input type="file" aria-label="Attachment" /></>;
  },
}));
vi.mock("@bb-studio/kit/app", async importOriginal => ({ ...(await importOriginal<typeof import("@bb-studio/kit/app")>()), Icon: () => null }));

const item = { pluginId: "artifacts", id: "first", kind: "artifact", kindLabel: "Artifact", title: "Release diagram", kindIcon: "File", icon: null, projectId: "proj_release", href: "/plugins/artifacts/artifacts/first" };
const ref = { pluginId: item.pluginId, id: item.id };
const quote = { text: "Fix the arrow", note: "", where: "top left", image: "data:image/png;base64,aGVsbG8=" };
let root: Root;
let container: HTMLDivElement;
/** The panel's sub-path for a draft route, as BB passes it. */
const subPathOf = (path: string) => decodeURIComponent(path.slice("/plugins/studio/chats/".length));
const render = async (path: string) => { await act(async () => { root.render(<ConversationPage subPath={subPathOf(path)} />); }); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.submit.clear(); state.props.clear();
  state.rpc.call.mockImplementation(async method => {
    if (method === "chat.subject") return { item };
    if (method === "chat.start") return { threadId: "created" };
    throw new Error(`Unexpected RPC ${method}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("new-conversation page", () => {
  it("starts in the item's project and opens the new thread in the main view", async () => {
    await render(itemDraftPath(ref));
    expect(state.props.get("studio-chat:artifacts:first")?.defaultProjectId).toBe(item.projectId);
    const request = { input: [{ type: "text", text: "Fix it" }] };
    await act(async () => { await state.submit.get("studio-chat:artifacts:first")!(request); });
    expect(state.rpc.call).toHaveBeenCalledWith("chat.start", { item: ref, request });
    expect(state.navigate.toThread).toHaveBeenCalledWith("created");
  });

  it("restores quote context, includes its image once, keeps it after a send failure, and removes it once the thread starts", async () => {
    const id = "1a0fdc3e-8eb5-4652-b596-424a021e409b";
    vi.spyOn(quoteDrafts, "get").mockResolvedValue({ id, item: ref, quote, createdAt: 1 });
    const remove = vi.spyOn(quoteDrafts, "remove").mockResolvedValue();
    await render(quoteDraftPath(id));
    const draftKey = `studio-chat:artifacts:first:quote:${id}`;
    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toContain("Fix the arrow");
    expect(container.querySelector("img")?.src).toBe(quote.image);
    const request = { input: [{ type: "text", text: "Make it clearer" }, { type: "file", url: "file:///release.txt" }] };
    state.rpc.call.mockRejectedValueOnce(new Error("Connection lost"));
    await act(async () => { await expect(state.submit.get(draftKey)!(request)).rejects.toThrow("Connection lost"); });
    expect(remove).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBe(textarea);
    expect(container.textContent).toContain("Connection lost");
    await act(async () => { await state.submit.get(draftKey)!(request); });
    expect(state.rpc.call).toHaveBeenLastCalledWith("chat.start", { item: ref, request: { input: [...request.input, { type: "image", url: quote.image }] } });
    expect(remove).toHaveBeenCalledWith(id);
    expect(state.navigate.toThread).toHaveBeenCalledWith("created");
  });

  it("reports archived items and retries without composing about another item", async () => {
    state.rpc.call.mockResolvedValueOnce({ item: null });
    await render(itemDraftPath(ref));
    expect(container.textContent).toContain("archived or gone");
    expect(container.querySelector("textarea")).toBeNull();
    await act(async () => { container.querySelector("button")!.click(); });
    expect(container.querySelector("textarea")).not.toBeNull();
  });
});
