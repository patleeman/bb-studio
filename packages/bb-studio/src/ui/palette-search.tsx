// Studio's items in BB's own search palette (Mod+K), where the running BB
// has `slots.experimental_paletteSearch`. BB lists threads itself, so this
// leaves them out. The slot's search runs outside React; an always-mounted
// bridge lends it Studio's RPC client.
import { useEffect } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { PaletteSearchResult } from "../kit/app/host-sdk";
import { openFrom, routeContainer } from "./studio-open";
import { hostIcon } from "./item-icons";

/** Opens an item in the workbench from outside React (the palette row's Mod+Enter). */
function openBeside(href: string, title: string): void {
  openFrom(routeContainer(), { href, ...(title ? { title } : {}) }, { target: "workbench" }, { toThread: () => {}, openUrl: () => false });
}

const LIMIT = 12;
const SUBTITLE_MAX = 120;

type Search = (query: string) => Promise<readonly PaletteSearchResult[]>;

let search: Search | null = null;

export interface PaletteHit {
  ref: { pluginId: string; id: string };
  kind: string;
  title: string;
  snippet: { text: string };
  href: string;
}

/** The palette rows for Studio's search hits: items only, with the kind and a snippet beneath. */
export function paletteRows(hits: readonly PaletteHit[]): PaletteSearchResult[] {
  return hits.filter((hit) => hit.kind !== "thread" && hit.href.startsWith("/")).map((hit) => {
    const kind = hit.kind.charAt(0).toUpperCase() + hit.kind.slice(1);
    const snippet = hit.snippet.text.replace(/\s+/g, " ").trim();
    const subtitle = snippet && snippet !== hit.title ? `${kind} · ${snippet}` : kind;
    return {
      id: `${hit.ref.pluginId}:${hit.ref.id}`, title: hit.title || "Untitled", subtitle: subtitle.slice(0, SUBTITLE_MAX), path: hit.href,
      // Enter shows the item in the main view; Mod+Enter opens it beside what is on screen.
      icon: hostIcon(hit.kind),
      experimental_onModSelect: () => openBeside(hit.href, hit.title),
      experimental_modSelectLabel: "Open in workbench",
    };
  });
}

const KIND_PREFIX: Record<string, string> = { page: "page", pages: "page", board: "drawing", boards: "drawing", app: "mini", apps: "mini" };

/** "page: plan" searches pages only; the same for "board:" and "app:". */
export function paletteQuery(query: string): { query: string; kinds?: string[] } {
  const match = /^\s*([a-z]+):\s*(.*)$/i.exec(query);
  const kind = match ? KIND_PREFIX[match[1]!.toLowerCase()] : undefined;
  return kind ? { query: match![2]!, kinds: [kind] } : { query };
}

/** What Studio registers with the slot. Empty until the bridge is mounted. */
export async function searchStudioItems(query: string, { signal }: { signal: AbortSignal }): Promise<readonly PaletteSearchResult[]> {
  if (!search) return [];
  const rows = await search(query);
  return signal.aborted ? [] : rows;
}

export function PaletteSearchBridge() {
  const rpc = useRpc<typeof rpcContract>();
  useEffect(() => {
    const run: Search = async (query) => {
      const parsed = paletteQuery(query);
      return paletteRows(await rpc.call("searchAll", { query: parsed.query.slice(0, 200), limit: LIMIT, ...(parsed.kinds ? { kinds: parsed.kinds } : {}) }));
    };
    search = run;
    return () => { if (search === run) search = null; };
  }, [rpc]);
  return null;
}
