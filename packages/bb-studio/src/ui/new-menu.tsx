// Studio's rows in BB's sidebar New menu, where the running BB has
// `slots.experimental_sidebarNewItem`: the kinds Studio can make, then a Bot.
// The rows are registered once; what a row does is looked up when it is
// picked, from the same list as every other Studio New menu (create-menu.ts).
// A row's run is called outside React, so an always-mounted bridge lends it
// Studio's RPC client and the open project.
import { familyOf } from "./studio-tab/model";
import { ITEM_FAMILIES } from "../item-model";
import { useEffect } from "react";
import { toast } from "sonner";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import type { ProviderView, rpcContract } from "../contract";
import { registerSidebarNewItem } from "../kit/app/host-sdk";
import { createEntries, runCreateEntry, type CreateEntry } from "./create-menu";
import { appliedKinds } from "./kinds-snapshot";
import { openFrom } from "./studio-open";

type Rpc = { call(method: string, input: unknown): Promise<unknown> };

let bridge: { rpc: Rpc; projectId: string | null } | null = null;

/** The rows, in menu order. `kind` is the Studio kind id a row makes. */
// Pages first (documents), then Apps (things that run); each family sits under its own divider.
export const NEW_MENU_KINDS: readonly { kind: string; title: string; icon: string }[] = [
  { kind: "page", title: "Page", icon: "FileText" },
  { kind: "drawing", title: "Whiteboard", icon: "Edit" },
  { kind: "design", title: "Design", icon: "Palette" },
  { kind: "mini", title: "App", icon: "AppWindow" },
  { kind: "dashboard", title: "Dashboard", icon: "ChartColumn" },
];

/** A row's group in BB's menu: its family's ("pages", "apps"), the names the groups have always had. */
const familyGroup = (kind: string) => ITEM_FAMILIES.find((family) => family.id === familyOf(kind))?.segment ?? "studio";

const NEW_BOT_PATH = "/plugins/studio/studio/bot/new";

/** Shows a path in the main view by Studio's open rule, from outside React. */
function showInMain(href: string): void {
  openFrom(null, { href }, { target: "main" }, { toThread: () => {}, openUrl: () => false });
}

/** The create entry a row stands for; a whiteboard is its own entry. */
export function entryFor(kind: string, entries: readonly CreateEntry[]): CreateEntry | null {
  if (kind === "drawing") return entries.find((entry) => entry.type === "whiteboard") ?? null;
  return entries.find((entry) => entry.type === "kind" && entry.kind.id === kind) ?? null;
}

/**
 * Makes a `kind` (a Studio kind id: "page", "drawing") and shows it with
 * `open`: by default in the main view, like a new thread; the New Tab page's
 * "New …" actions open it as a tab (src/ui/tab-kind-tabs.tsx).
 */
export async function createKind(kind: string, title: string, open: (href: string) => void = showInMain): Promise<void> {
  if (!bridge) { toast.error("Studio is still starting. Try again in a moment."); return; }
  const { rpc, projectId } = bridge;
  const { providers } = await rpc.call("overview", null) as { providers?: ProviderView[] };
  const entry = entryFor(kind, createEntries(providers ?? [], { off: appliedKinds()?.off }));
  if (!entry) { toast.error(`${title} is turned off or not ready in Studio.`); return; }
  await runCreateEntry(entry, { rpc, projectId, open });
}

const create = (kind: string, title: string) => createKind(kind, title);

/** Registers the rows; false on a BB without the New menu slot. */
export function registerNewMenu(slots: object): boolean {
  let registered = false;
  for (const { kind, title, icon } of NEW_MENU_KINDS) {
    registered = registerSidebarNewItem(slots, { id: `new-${kind}`, title, icon, group: familyGroup(kind), run: () => create(kind, title) }) || registered;
  }
  return registerSidebarNewItem(slots, { id: "new-bot", title: "Bot", icon: "Bot", group: "bot", run: () => showInMain(NEW_BOT_PATH) }) || registered;
}

export function NewMenuBridge() {
  const rpc = useRpc<typeof rpcContract>();
  const { projectId } = useBbContext();
  useEffect(() => {
    const mine = { rpc: rpc as Rpc, projectId: projectId ?? null };
    bridge = mine;
    return () => { if (bridge === mine) bridge = null; };
  }, [rpc, projectId]);
  return null;
}
