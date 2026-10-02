// @vitest-environment jsdom
import React, { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemHeader } from "./item-header";

const state = vi.hoisted(() => ({ launch: null as ((mode: string) => void) | null }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toCompose: () => {} }) }));
vi.mock("./item-chat", () => ({
  useHomeThread: () => null,
  useItemChat: () => ({
    open: () => state.launch?.("compose"),
    start: () => state.launch?.("compose"),
    choose: () => state.launch?.("choose"),
  }),
}));
vi.mock("./presence", () => ({ useStudioChatPresent: () => true }));
vi.mock("./float", () => ({ useInFloat: () => true, useCanFloat: () => true }));
vi.mock("./move", () => ({ useOpenTarget: () => ({ open: () => {}, anchor: null }) }));
vi.mock("./related-panel", () => ({ RelatedPanel: () => null }));
vi.mock("./space-picker", () => ({ SpacePicker: () => null }));
vi.mock("../ui/icon", () => ({ Icon: () => null }));

function Dialog({ mode, close }: { mode: string; close(): void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return <input aria-label={mode} ref={input} onBlur={close} />;
}

function Harness() {
  const [mode, setMode] = useState<string | null>(null);
  state.launch = setMode;
  return <>
    <ItemHeader backLabel="Studio" onBack={() => {}} item={{ title: "Launch", href: "/plugins/pages/pages/launch" }} />
    {mode ? <Dialog mode={mode} close={() => setMode(null)} /> : null}
  </>;
}

let root: Root;
let container: HTMLDivElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const menu = async () => {
  await act(async () => {
    document.querySelector('[aria-label="Chat options"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    await settle();
  });
};

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); state.launch = null; });

describe("Chat menu focus", () => {
  it("lets a conversation-owning view supply one Chat action or opt out", async () => {
    const item = { title: "Atlas", href: "/plugins/bot-teams/bots/atlas" };
    await act(async () => root.render(<ItemHeader backLabel="Studio" onBack={() => {}} item={item} chatAction={<button>Chat with Atlas</button>} />));
    expect(container.textContent).toBe("Chat with Atlas");
    expect(container.querySelector('[data-studio-chat-item]')).toBeNull();
    await act(async () => root.render(<ItemHeader backLabel="Studio" onBack={() => {}} item={item} chatAction={null} />));
    expect(container.querySelector("button")).toBeNull();
  });
  it("uses the companion's navigation chrome inside Float", () => {
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Studio")).toBe(false);
    expect(container.querySelector('[data-studio-chat-item="pages:launch"] > button')?.textContent?.trim()).toBe("Chat");
  });
  it.each([["New conversation", "compose"], ["Choose conversation…", "choose"]])("keeps %s focused after the menu closes", async (label, mode) => {
    await menu();
    const entry = [...document.querySelectorAll('[role="menuitem"]')].find((element) => element.textContent?.trim() === label) as HTMLElement;
    expect(entry).toBeDefined();
    await act(async () => { entry.click(); await settle(); });
    expect(document.activeElement).toBe(document.querySelector(`[aria-label="${mode}"]`));
    expect(document.querySelector(`[aria-label="${mode}"]`)).not.toBeNull();
  });

  it("restores focus to Chat options when the menu is dismissed", async () => {
    await menu();
    await act(async () => {
      document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await settle();
    });
    expect(document.activeElement).toBe(document.querySelector('[aria-label="Chat options"]'));
  });
});
