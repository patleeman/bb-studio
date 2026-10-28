// The one list behind every Studio "New" menu: the new tab page, the
// sidebar's +, the thread's Studio tab and the tab strip's. Each menu draws
// these entries in its own style, so they offer the same things in the same
// order: every kind Studio can make, then Record a call, then templates.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ProviderView } from "../contract";
import { createStudioItem } from "../kit/app/create-item";
import { errorMessage } from "../kit/format";
import { openAppPath } from "../kit/app/nav";
import { openCallPicker } from "../talk/ui/call-view";
import { appliedKinds } from "./kinds-snapshot";
import { parseQuery, resolveValue } from "../query";
import { KIND_ORDER } from "./studio-sidebar-model";

type ProviderKind = ProviderView["kinds"][number];
export interface TemplateRef { pluginId: string; id: string; title: string }

export type CreateEntry =
  | { type: "kind"; key: string; label: string; icon: string; pluginId: string; addOn: string; kind: ProviderKind }
  | { type: "call"; key: "talk:call"; label: string; icon: string }
  | { type: "template"; key: string; label: string; icon: string; template: TemplateRef };

/** Every New menu's entries, from the providers that are ready and the kinds that are on. */
export function createEntries(providers: readonly ProviderView[], { off = new Set<string>(), templates = [] }: { off?: ReadonlySet<string>; templates?: readonly TemplateRef[] } = {}): CreateEntry[] {
  const ready = providers.filter((provider) => provider.state === "ready");
  const rank = (id: string) => { const at = KIND_ORDER.indexOf(id); return at < 0 ? KIND_ORDER.length : at; };
  const kinds = ready
    .flatMap((provider) => provider.kinds.filter((kind) => kind.create && (kind.capabilities?.create ?? true) && !off.has(kind.id)).map((kind) => ({ provider, kind })))
    .map((each, index) => ({ ...each, index }))
    .sort((a, b) => rank(a.kind.id) - rank(b.kind.id) || a.index - b.index)
    .map(({ provider, kind }): CreateEntry => ({ type: "kind", key: `${provider.pluginId}:${kind.id}`, label: kind.label, icon: kind.icon, pluginId: provider.pluginId, addOn: provider.name, kind }));
  // A call is a Talk recording: offered wherever recordings are.
  const calls = !off.has("recording") && ready.some((provider) => provider.kinds.some((kind) => kind.id === "recording"))
    ? [{ type: "call", key: "talk:call", label: "Record a call", icon: "studio/call" } as const]
    : [];
  const fromTemplates = templates.map((template): CreateEntry => ({ type: "template", key: `template:${template.pluginId}:${template.id}`, label: `From template: ${template.title || "Untitled"}`, icon: "Copy", template }));
  return [...kinds, ...calls, ...fromTemplates];
}

/** Whether a menu draws a separator before entry `index`: between the kinds and the rest. */
export function startsGroup(entries: readonly CreateEntry[], index: number): boolean {
  return index > 0 && entries[index]!.type !== "kind" && entries[index - 1]!.type === "kind";
}

/**
 * Where the tab strip's New puts an item: the project BB has open, else the
 * one project the library's Project filter picks, else nowhere (Global).
 */
export function newItemProject(openProjectId: string | null | undefined, libraryQuery: string, projects: readonly { id: string; name: string }[]): string | null {
  if (openProjectId) return openProjectId;
  const vocabulary = { kinds: [], projects, tags: [] };
  const picked = new Set(parseQuery(libraryQuery).filters.filter((filter) => filter.field === "project" && !filter.negate).map((filter) => resolveValue(filter, vocabulary)));
  const [only] = picked;
  return picked.size === 1 && only ? only : null;
}

type Rpc = { call(method: string, input: unknown): Promise<unknown> };

/** The entries for `providers`, with the templates fetched when `refresh` changes. */
export function useCreateEntries(rpc: Rpc, providers: readonly ProviderView[], refresh?: unknown): CreateEntry[] {
  const [templates, setTemplates] = useState<TemplateRef[]>([]);
  useEffect(() => {
    let live = true;
    rpc.call("templates", null).then(
      (result) => { if (live) setTemplates((result as { items?: TemplateRef[] } | null)?.items ?? []); },
      () => { if (live) setTemplates([]); },
    );
    return () => { live = false; };
  }, [rpc, refresh]);
  return useMemo(() => createEntries(providers, { off: appliedKinds()?.off, templates }), [providers, templates]);
}

export interface RunCreateOptions {
  rpc: Rpc;
  projectId: string | null;
  /** Makes an "rpc" kind's item itself, as the thread's Studio tab does to link it. */
  createKind?(entry: Extract<CreateEntry, { type: "kind" }>): Promise<void> | void;
  /** After a template made an item. */
  onCreated?(): void;
}

/** Does what a picked entry says. Reports failures as toasts. */
export async function runCreateEntry(entry: CreateEntry, { rpc, projectId, createKind, onCreated }: RunCreateOptions): Promise<void> {
  if (entry.type === "call") return openCallPicker();
  if (entry.type === "template") {
    const name = window.prompt("Name for this template (optional)", "");
    if (name === null) return;
    try {
      const { item } = await rpc.call("instantiateTemplate", { pluginId: entry.template.pluginId, id: entry.template.id, projectId, variables: { name } }) as { item: { href: string } };
      onCreated?.();
      openAppPath(item.href);
    } catch (cause) {
      toast.error(`Couldn't use template: ${errorMessage(cause)}`);
    }
    return;
  }
  if (createKind && entry.kind.create?.mode === "rpc") return createKind(entry);
  return createStudioItem(entry.kind, {
    projectId,
    addOn: entry.addOn,
    create: async () => ((await rpc.call("create", { pluginId: entry.pluginId, kind: entry.kind.id, projectId })) as { item: { href: string } }).item.href,
  });
}
