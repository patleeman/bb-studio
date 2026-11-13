// @vitest-environment jsdom
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { act, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { markdownToBlocks } from "../pages/markdown";
import { studioRef } from "../pages/schema-config";
import { whenOn } from "./kinds-snapshot";
import { APP_CARD_DIRECTIVES, registerAppCards } from "./app-card";

const Saved = ({ attributes }: PluginMessageDirectiveProps) => <div data-card="saved">{attributes.id}</div>;
const Interactive = ({ attributes }: PluginMessageDirectiveProps) => <div data-card="interactive">{attributes.id}</div>;

type Card = ComponentType<PluginMessageDirectiveProps>;

function registered(renderers: { saved: Card; interactive: Card } = { saved: Saved, interactive: Interactive }) {
  const directives = new Map<string, ComponentType<PluginMessageDirectiveProps>>();
  registerAppCards({ slots: { messageDirective: ({ id, component }: { id: string; component: ComponentType<PluginMessageDirectiveProps> }) => { directives.set(id, component); } } } as never, renderers);
  return directives;
}

function html(Component: ComponentType<PluginMessageDirectiveProps>, id: string): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Component attributes={{ id }} message={{ threadId: "thr_1" } as never} {...({} as Omit<PluginMessageDirectiveProps, "attributes" | "message">)} />));
  const out = container.innerHTML;
  act(() => root.unmount());
  return out;
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

it("registers ::app and keeps ::artifact and ::mini, all as the one card", () => {
  const directives = registered();
  expect([...directives.keys()]).toEqual(["app", "artifact", "mini"]);
  expect(APP_CARD_DIRECTIVES).toEqual(["app", "artifact", "mini"]);
  expect(new Set(directives.values()).size).toBe(1);
});

it("renders the same card for the same id under each directive, picked by the id's prefix", () => {
  const directives = registered();
  for (const [id, card] of [["art_0123456789abcdef", "saved"], ["mini_0123456789abcdef", "interactive"]] as const) {
    const out = [...directives.values()].map((component) => html(component, id));
    expect(out[0]).toBe(`<div data-card="${card}">${id}</div>`);
    expect(new Set(out).size).toBe(1);
  }
  expect(html(directives.get("app")!, "nonsense")).toBe('<div data-card="saved">nonsense</div>');
});

it("follows each kind's switch: a kind that's off renders nothing, the other still renders", () => {
  const directives = registered({ saved: whenOn({ off: new Set(["artifact"]), routedAway: new Set() }, "artifact", Saved), interactive: Interactive });
  expect(html(directives.get("app")!, "art_0123456789abcdef")).toBe("");
  expect(html(directives.get("artifact")!, "art_0123456789abcdef")).toBe("");
  expect(html(directives.get("mini")!, "mini_0123456789abcdef")).toBe('<div data-card="interactive">mini_0123456789abcdef</div>');
});

it("keeps page embeds of kind artifact and mini", () => {
  const blocks = markdownToBlocks('```embed\n{"kind":"artifact","target":"art_0123456789abcdef"}\n```\n\n```embed\n{"kind":"mini","target":"mini_0123456789abcdef"}\n```\n');
  expect(blocks.map((block) => block.props)).toMatchObject([{ kind: "artifact", target: "art_0123456789abcdef" }, { kind: "mini", target: "mini_0123456789abcdef" }]);
  expect(studioRef("artifact", "art_0123456789abcdef")).toEqual({ pluginId: "artifacts", id: "art_0123456789abcdef" });
  expect(studioRef("mini", "mini_0123456789abcdef")).toEqual({ pluginId: "minis", id: "mini_0123456789abcdef" });
});
