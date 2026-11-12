// Makes a Studio kind from outside React, by the same list as every other
// Studio New menu (create-menu.ts). An always-mounted bridge lends it
// Studio's RPC client and the open project.
import { useEffect } from "react";
import { toast } from "sonner";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import type { ProviderView, rpcContract } from "../contract";
import { createEntries, runCreateEntry, type CreateEntry } from "./create-menu";
import { appliedKinds } from "./kinds-snapshot";
import { openFrom } from "./studio-open";

type Rpc = { call(method: string, input: unknown): Promise<unknown> };

let bridge: { rpc: Rpc; projectId: string | null } | null = null;

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
