import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { windowsContract } from "../windows/contract";
import { routeContainer } from "../kit/app/container";
import { member, workbenchOf } from "../kit/app/host-sdk";
import { openAppPath } from "../kit/app/nav";
import { inHostWindow } from "../kit/app/windows";
import { STUDIO_PLUGIN, type TabRef } from "../tab-kinds";
import { openStudioTab, openTabRef, pageWorkbenchOf } from "../ui/tab-open";
import type { linksContract } from "./contract";
import { runLinkAction } from "./actions";
import { openLink, parseLink, type LinkDeps, type LinkHow, type LinkOutcome, type LinkResolution, type LinkSource, type LinkTarget, type OpenLinkOptions } from "./router";

type Navigate = { openUrl(url: string): boolean };
type Rpc = { call(method: string, input: unknown): Promise<unknown> };

export interface LinkRuntime { navigate: Navigate; rpc: Rpc }

let runtime: LinkRuntime | null = null;

export function setLinkRuntime(next: LinkRuntime | null): () => void {
  runtime = next;
  return () => { if (runtime === next) runtime = null; };
}

export function hasLinkRuntime(): boolean {
  return runtime !== null;
}

export const BARE_WINDOW_KEY = "bbBare";

export function inMainWindow(location: { pathname: string; search: string } = typeof window === "undefined" ? { pathname: "", search: "" } : window.location): boolean {
  return !inHostWindow(location.pathname) && new URLSearchParams(location.search).get(BARE_WINDOW_KEY) !== "1";
}

function popOutOf(navigate: object): ((path: string, title: string | null) => Promise<boolean>) | null {
  const method = member(navigate, "experimental_popOut");
  if (typeof method !== "function") return null;
  return (path, title) => Promise.resolve((method as (options: { path: string; title?: string }) => Promise<boolean>).call(navigate, { path, ...(title ? { title } : {}) })).catch(() => false);
}

const onAutomationsPage = (): boolean => typeof window !== "undefined" && /^\/plugins\/studio\/automations(?:\/|$)/.test(window.location.pathname);

export function linkDeps({ navigate, rpc }: LinkRuntime): LinkDeps {
  const popOut = popOutOf(navigate);
  return {
    inMain: () => inMainWindow(),
    relay: async (link, how) => { await rpc.call("window.runInMain", { kind: "link", link, how }); },
    thread: () => { const container = routeContainer(); return container?.kind === "thread" ? container.threadId : null; },
    studioPage: () => routeContainer()?.kind === "studio" || onAutomationsPage(),
    resolve: async (ref: TabRef, threadId) => (await rpc.call("links.resolve", { kind: ref.kind, id: ref.id, threadId })) as LinkResolution,
    workbench: (threadId) => workbenchOf(navigate, threadId),
    pageWorkbench: () => pageWorkbenchOf(navigate),
    openTab: (ref, title, place) => openTabRef(ref, title, place),
    openStudioTab: (open, place) => openStudioTab({ ...open, pluginId: STUDIO_PLUGIN }, place),
    openMain: (path) => openAppPath(path),
    popOut: popOut ?? (async () => false),
    openUrl: (url) => { try { return navigate.openUrl(url); } catch { return false; } },
    action: (action) => runLinkAction(action),
    toast: (message) => { toast.error(message); },
  };
}

export type LinkInput = LinkTarget | string;

const targetOf = (input: LinkInput): LinkTarget | null => (typeof input === "string" ? parseLink(input) : input);

export async function openLinkWith(deps: LinkDeps, input: LinkInput, options: OpenLinkOptions): Promise<LinkOutcome> {
  const target = targetOf(input);
  if (!target) return { via: "none", reason: "Not a link to anything BB opens." };
  return openLink(target, options, deps);
}

export function openLinkFromAnywhere(input: LinkInput, options: OpenLinkOptions): Promise<LinkOutcome> {
  if (!runtime) return Promise.resolve({ via: "none", reason: "Studio is still starting." });
  return openLinkWith(linkDeps(runtime), input, options).catch((error: unknown): LinkOutcome => ({ via: "none", reason: error instanceof Error ? error.message : String(error) }));
}

export function routesLink(input: LinkInput): boolean {
  const type = targetOf(input)?.type;
  return type === "entity" || type === "action";
}

export function useOpenLink(): (input: LinkInput, options: OpenLinkOptions) => Promise<LinkOutcome> {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof linksContract & typeof windowsContract>();
  return useCallback((input, options) => openLinkWith(linkDeps({ navigate, rpc: rpc as unknown as Rpc }), input, options).catch((error: unknown): LinkOutcome => ({ via: "none", reason: error instanceof Error ? error.message : String(error) })), [navigate, rpc]);
}

export interface CardClick { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }

export const clickModifiers = (event?: CardClick | null): { meta: boolean; ctrl: boolean; shift: boolean } => ({ meta: Boolean(event?.metaKey), ctrl: Boolean(event?.ctrlKey), shift: Boolean(event?.shiftKey) });

export function useOpenCard(threadId: string, source: LinkSource = "card"): (link: string, title: string | null, how?: LinkHow) => (event?: CardClick) => void {
  const open = useOpenLink();
  return useCallback((link, title, how) => (event) => { void open(link, { source, threadId, title, ...(how ? { how } : { modifiers: clickModifiers(event) }) }); }, [open, source, threadId]);
}

export function LinksBridge() {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof linksContract & typeof windowsContract>();
  useEffect(() => setLinkRuntime({ navigate, rpc: rpc as unknown as Rpc }), [navigate, rpc]);
  return null;
}

export type { LinkHow, LinkOutcome, LinkTarget, OpenLinkOptions };
