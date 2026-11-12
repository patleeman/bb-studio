// What Studio offers to a launcher through BB's launcher slot
// (`slots.experimental_launcherItem`), the same way any plugin does: its apps
// (BB Studio's main window, the HUD, VS Code) and actions (New conversation,
// Ask the Bot, New page). Visual Chat registers its own app.
//
// BB calls a row's `run` in the launcher's window, outside React, so the
// launcher (ui/Launcher.tsx) lends these what they need while it is mounted:
// Studio's RPC client and BB's windows.
import type { ProviderView } from "../contract";
import { registerLauncherItem, type LauncherItemRegistration } from "../kit/app/host-sdk";
import { STUDIO_PLUGIN_ID } from "../kit/contract";
import type { HostWindows } from "../kit/app/windows";
import { HUD_WINDOW_ID, hudWindowOptions } from "../hud/shared";
import { createEntries, runCreateEntry } from "../ui/create-menu";
import { appliedKinds } from "../ui/kinds-snapshot";
import { entryFor } from "../ui/new-menu";
import { NEW_THREAD_PATH, threadPath, VSCODE_MAIN_PATH } from "./shared";

type Rpc = { call(method: string, input: unknown): Promise<unknown> };

export interface LauncherRuntime {
  rpc: Rpc;
  windows: Pick<HostWindows, "open" | "close">;
  /** The HUD's shortcut in use (its window is registered with it), empty for none. */
  hudHotkey: string;
}

let runtime: LauncherRuntime | null = null;

/** Lends Studio's rows what they run with; null when the launcher goes away. */
export function setLauncherRuntime(next: LauncherRuntime | null): void {
  runtime = next;
}

function lent(): LauncherRuntime {
  if (!runtime) throw new Error("Studio's launcher isn't open.");
  return runtime;
}

/** Shows an in-app path in BB's main window and brings it forward. */
export async function openInMain(path: string): Promise<void> {
  await lent().rpc.call("window.openInMain", { path });
}

/**
 * Opens the HUD's window, as every other way in does. With `threadId`, on
 * that conversation: an open HUD showing another one loads it in place.
 */
export async function openHud(threadId?: string): Promise<void> {
  const { windows, hudHotkey } = lent();
  await windows.open(HUD_WINDOW_ID, hudWindowOptions({ hotkey: hudHotkey, screen: window.screen, threadId }));
}

/** Makes a page and shows it in the main window. */
export async function newPage(): Promise<void> {
  const { rpc } = lent();
  const { providers } = await rpc.call("overview", null) as { providers?: ProviderView[] };
  const entry = entryFor("page", createEntries(providers ?? [], { off: appliedKinds()?.off }));
  if (!entry) throw new Error("Pages are turned off or not ready in Studio.");
  await runCreateEntry(entry, { rpc, projectId: null, open: (href) => { void openInMain(href).catch(() => {}); } });
}

/** The current Bot's Main conversation in the main window, to ask it something. */
export async function askTheBot(): Promise<void> {
  const { rpc } = lent();
  const spaces = await rpc.call("bot_spaces", {}) as { bots?: { id: string; mainThreadId: string | null }[]; currentBotId?: string | null } | null;
  const bot = spaces?.bots?.find((each) => each.id === spaces.currentBotId) ?? spaces?.bots?.[0];
  if (!bot?.mainThreadId) throw new Error("Make your Bot first: Studio → Bot.");
  await openInMain(threadPath(bot.mainThreadId));
}

export const HUD_LAUNCHER_ITEM = "hud";

export const STUDIO_LAUNCHER_ITEMS: readonly LauncherItemRegistration[] = [
  { id: "studio", title: "BB Studio", icon: "studio/studio", section: "apps", keywords: ["bb", "main window", "home"], order: 10, run: () => openInMain(NEW_THREAD_PATH) },
  { id: HUD_LAUNCHER_ITEM, title: "HUD", icon: "AppWindow", section: "apps", keywords: ["bot", "chat", "floating"], order: 20, run: () => openHud() },
  { id: "vscode", title: "VS Code", icon: "Code", section: "apps", keywords: ["editor", "code", "workspace"], order: 40, run: () => openInMain(VSCODE_MAIN_PATH) },
  // A thread Patrick starts is a conversation of the Bot the sidebar shows (src/bot-threads.ts).
  { id: "new-conversation", title: "New conversation", icon: "MessageSquarePlus", section: "actions", keywords: ["chat", "compose", "start", "thread"], order: 10, run: () => openInMain(NEW_THREAD_PATH) },
  { id: "ask-bot", title: "Ask the Bot", icon: "Bot", section: "actions", keywords: ["main", "chief", "question"], order: 15, run: askTheBot },
  { id: "new-page", title: "New page", icon: "FileText", section: "actions", keywords: ["document", "doc", "note", "write"], order: 20, run: newPage },
];

/** Registers Studio's rows; false on a BB without the launcher slot. The HUD only where `windows` (BB can open plugin windows). */
export function registerLauncherItems(slots: object, windows: boolean): boolean {
  let registered = false;
  for (const item of STUDIO_LAUNCHER_ITEMS) {
    if (item.id === HUD_LAUNCHER_ITEM && !windows) continue;
    registered = registerLauncherItem(slots, item) || registered;
  }
  return registered;
}

/** Whether a launcher row is Studio's HUD app, which the launcher leaves out while the HUD is off. */
export const isHudItem = (item: { pluginId: string; id: string }) => item.pluginId === STUDIO_PLUGIN_ID && item.id === HUD_LAUNCHER_ITEM;
