// @vitest-environment jsdom
import React, { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { botSchema } from "../contract";
import { ProfileForm } from "../bot-ui";

const state = vi.hoisted(() => ({ updates: 0 }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => ({ call: vi.fn() }), useBbNavigate: () => ({}), experimental_Icon: () => null,
  experimental_PermissionModePicker: () => null,
  experimental_ProviderModelPicker: ({ value, onChange }: any) => {
    useLayoutEffect(() => {
      state.updates++;
      if (state.updates > 20) throw new Error("Picker never settles");
      onChange({ ...value, model: value.model || "catalog-default", serviceTier: "priority" });
    }, [value, onChange]);
    return React.createElement("output", { "data-model": value.model }, value.model);
  },
}));
vi.mock("../markdown-editor", () => ({ MarkdownEditor: () => null }));
vi.mock("../revision-list", () => ({ RevisionList: () => null }));
vi.mock("../controls", () => ({ Modal: () => null }));
vi.mock("@bb-studio/kit/app", () => ({ EmptyState: () => null, PILL: "", SECTION_TITLE: "" }));
vi.mock("@bb-studio/kit/ui", () => ({
  Button: ({ children, ...props }: any) => React.createElement("button", props, children),
  Input: (props: any) => React.createElement("input", props),
  Select: () => null, SelectContent: () => null, SelectItem: () => null, SelectTrigger: () => null, SelectValue: () => null,
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS: "",
}));

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("settles catalog defaults and ignores picker-only tiers without discarding an unsaved profile", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.updates = 0;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const bot = botSchema.parse({ id: "bot_0000000000000001", name: "Atlas", handle: "atlas", home: "/staged/atlas", projectId: "staged", hostId: "staged", createdAt: 1, updatedAt: 1, lastWakeAt: 0, error: null, fallbackProviderId: "codex", fallbackModel: "fallback" });
  try {
    await act(async () => root.render(React.createElement(ProfileForm, { bot, onSaved: vi.fn() })));
    expect([...host.querySelectorAll("output")].map(node => node.dataset.model)).toEqual(["catalog-default", "fallback"]);
    expect(state.updates).toBeLessThan(12);
    const name = host.querySelector<HTMLInputElement>('input[id$="-name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Unsaved Atlas");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => root.render(React.createElement(ProfileForm, { bot: { ...bot }, onSaved: vi.fn() })));
    expect(name.value).toBe("Unsaved Atlas");
    expect(host.querySelector("output")!.dataset.model).toBe("catalog-default");
    expect(JSON.parse(localStorage.getItem(`bb:bots:profile:${bot.id}`)!).draft.name).toBe("Unsaved Atlas");
  } finally { act(() => root.unmount()); host.remove(); }
});
