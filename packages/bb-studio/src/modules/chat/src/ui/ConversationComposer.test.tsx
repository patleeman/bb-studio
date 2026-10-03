// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloatPanels, publishFloatBody, setFloatHost } from "@bb-studio/kit/app";
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
let body: HTMLDivElement;
const navigate = vi.fn();
const open = vi.fn();
const target = { kind: "path" as const, path: itemDraftPath(ref) };
const render = async () => { await act(async () => { root.render(<FloatPanels path="chats" render={subPath => <ConversationPage subPath={subPath} />} />); }); };
const anchor = async (key: string, path = target.path, element = body, placement: "floating" | "workbench" | "main" = "floating") => {
  await act(async () => { publishFloatBody({ windowKey: key, target: { kind: "path", path }, element, placement }); });
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.submit.clear(); state.props.clear();
  state.rpc.call.mockImplementation(async method => {
    if (method === "chat_subject") return { item };
    if (method === "chat_start") return { threadId: "created" };
    throw new Error(`Unexpected RPC ${method}`);
  });
  setFloatHost({ open, navigate });
  container = document.createElement("div"); body = document.createElement("div");
  document.body.append(container, body);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const windowKey of ["first", "second", "quote"]) publishFloatBody({ windowKey, element: null });
  setFloatHost(null);
  container.remove(); body.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("retained new-conversation tabs", () => {
  it("keeps the native draft and file input through hiding and placement changes", async () => {
    await anchor("first");
    const textarea = body.querySelector("textarea")!;
    const input = body.querySelector("input")!;
    textarea.value = "Keep my draft";
    const file = new File(["Release checklist"], "release.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { value: [file] });
    body.hidden = true;
    await anchor("first", target.path, body, "workbench");
    body.hidden = false;
    await anchor("first", target.path, body, "main");
    expect(body.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("Keep my draft");
    expect(body.querySelector("input")).toBe(input);
    expect(input.files?.[0]).toBe(file);
    expect(state.props.get("studio-chat:artifacts:first")?.defaultProjectId).toBe(item.projectId);
  });

  it("replaces only the originating composer tab when a background submission finishes", async () => {
    await anchor("first");
    let release!: (value: { threadId: string }) => void;
    state.rpc.call.mockImplementation(method => method === "chat_start" ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ item }));
    const request = { input: [{ type: "text", text: "Fix it" }] };
    let sending!: Promise<void>;
    await act(async () => { sending = state.submit.get("studio-chat:artifacts:first")!(request); });
    const second = document.createElement("div"); document.body.append(second);
    try {
      await anchor("second", "/plugins/studio/chats", second);
      const draft = second.querySelector("textarea")!; draft.value = "A different draft";
      await act(async () => { release({ threadId: "created" }); await sending; });
      expect(navigate).toHaveBeenCalledWith("first", { kind: "thread", threadId: "created" });
      expect(open).not.toHaveBeenCalled();
      expect(second.querySelector("textarea")).toBe(draft);
      expect(draft.value).toBe("A different draft");
      expect(state.rpc.call).toHaveBeenCalledWith("chat_start", { item: ref, request });
    } finally { second.remove(); }
  });

  it("restores quote context, includes its image once, and keeps it after a send failure", async () => {
    const id = "1a0fdc3e-8eb5-4652-b596-424a021e409b";
    vi.spyOn(quoteDrafts, "get").mockResolvedValue({ id, item: ref, quote, createdAt: 1 });
    const remove = vi.spyOn(quoteDrafts, "remove").mockResolvedValue();
    await anchor("quote", quoteDraftPath(id));
    const draftKey = `studio-chat:artifacts:first:quote:${id}`;
    const textarea = body.querySelector("textarea")!;
    expect(textarea.value).toContain("Fix the arrow");
    expect(body.querySelector("img")?.src).toBe(quote.image);
    const request = { input: [{ type: "text", text: "Make it clearer" }, { type: "file", url: "file:///release.txt" }] };
    state.rpc.call.mockRejectedValueOnce(new Error("Connection lost"));
    await act(async () => { await expect(state.submit.get(draftKey)!(request)).rejects.toThrow("Connection lost"); });
    expect(remove).not.toHaveBeenCalled();
    expect(body.querySelector("textarea")).toBe(textarea);
    expect(body.textContent).toContain("Connection lost");
    await act(async () => { await state.submit.get(draftKey)!(request); });
    expect(state.rpc.call).toHaveBeenLastCalledWith("chat_start", { item: ref, request: { input: [...request.input, { type: "image", url: quote.image }] } });
    expect(remove).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("quote", { kind: "thread", threadId: "created" });
  });

  it("reports archived items and retries without composing about another item", async () => {
    state.rpc.call.mockResolvedValueOnce({ item: null });
    await anchor("first");
    expect(body.textContent).toContain("archived or gone");
    expect(body.querySelector("textarea")).toBeNull();
    await act(async () => { body.querySelector("button")!.click(); });
    expect(body.querySelector("textarea")).not.toBeNull();
  });
});
