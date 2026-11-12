// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
vi.mock("@get-bb/plugin-sdk/app", () => ({}));
vi.mock("../../presence/ui/BotFace", () => ({ BotFace: ({ botId, size, still, className }: { botId: string; size: number; still?: boolean; className?: string }) => <i data-face={botId} data-size={size} data-still={String(!!still)} className={className} /> }));
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
  expect(host.querySelector("[data-face]")).toBeNull();
  act(() => setAvatarSlots([{ id: "bot_main" }, { id: "bot_home" }]));
  const face = host.querySelector<HTMLElement>("[data-face]")!;
  expect(face.dataset).toMatchObject({ face: "bot_home", size: "16", still: "true" });
  expect(face.getAttribute("class")).toContain("size-4");
  act(() => setAvatarSlots([{ id: "bot_main" }, { id: "bot_work" }]));
  expect(host.querySelector<HTMLElement>("[data-face]")!.dataset.face).toBe("bot_work");
  act(() => root.unmount());
});
