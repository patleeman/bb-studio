// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
vi.mock("@get-bb/plugin-sdk/app", () => ({}));
import { AVATAR_SLOTS, avatarIcon, registerBotAvatarIcons, setAvatarSlots } from "./avatar-icons";

test("Bot avatars as app icons: one slot per Bot in list order, BB's Bot icon past the last", () => {
  expect(avatarIcon(0)).toBe("studio/bot-avatar-0");
  expect(avatarIcon(AVATAR_SLOTS - 1)).toBe(`studio/bot-avatar-${AVATAR_SLOTS - 1}`);
  expect(avatarIcon(AVATAR_SLOTS)).toBe("Bot");
  expect(avatarIcon(-1)).toBe("Bot");
});

test("a slot's icon draws the Bot put in it, and redraws when it changes", () => {
  const icons = new Map<string, React.ComponentType<{ className?: string }>>();
  registerBotAvatarIcons({ experimental_icons: { register: ({ name, component }: { name: string; component: React.ComponentType<{ className?: string }> }) => icons.set(name, component) } } as never);
  expect(icons.size).toBe(AVATAR_SLOTS);
  const Icon = icons.get("studio/bot-avatar-1")!;
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => setAvatarSlots([]));
  act(() => root.render(<Icon className="size-4" />));
  expect(host.querySelector("[data-shape]")).toBeNull();
  act(() => setAvatarSlots([{ avatar: "🟣", shape: "blob", color: "#000" }, { avatar: "🛰️", shape: "hexagon", color: "#2ba59a" }]));
  expect(host.querySelector("[data-shape]")?.getAttribute("data-shape")).toBe("hexagon");
  expect(host.querySelector("svg")?.getAttribute("class")).toContain("size-4");
  act(() => root.unmount());
});
