import { entryFor, type NewTabEntry } from "../newtab";
import { itemKindOfId, pathFor, tabKindEntry, type TabRef } from "../tab-kinds";
import type { OpenedTab } from "../ui/opened-tabs";
import { hostIcon } from "../ui/item-icons";
import { shownThreadTitle } from "../reply-title";
import type { LauncherDocument } from "./rank";
import { threadPath } from "./shared";

export interface SearchHit {
  ref: { pluginId: string; id: string };
  kind: string;
  title: string;
  href: string;
  updatedAt: number;
  threadKind?: "conversation" | "worker";
}

const kindLabel = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);

export function entryDocument(entry: NewTabEntry, found: boolean): LauncherDocument | null {
  const path = pathFor(entry.ref);
  if (!path) return null;
  return { key: entry.id, title: entry.title, icon: entry.icon, kind: entry.kind, path, updatedAt: entry.updatedAt, ref: entry.ref, ...(found ? { found } : {}) };
}

export function openedDocuments(opened: readonly OpenedTab[]): LauncherDocument[] {
  return opened.flatMap((each) => {
    const document = entryDocument(entryFor({ kind: each.kind, id: each.id }, tabKindEntry(each.kind).name, each.at), false);
    return document ? [document] : [];
  });
}

function hitRef(hit: SearchHit): TabRef | null {
  if (hit.kind === "thread") return { kind: hit.threadKind ?? "conversation", id: hit.ref.id };
  const kind = itemKindOfId(hit.ref.id);
  return kind ? { kind, id: hit.ref.id } : null;
}

export function hitDocument(hit: SearchHit, found: boolean): LauncherDocument | null {
  const ref = hitRef(hit);
  const thread = hit.kind === "thread";
  const path = thread ? threadPath(hit.ref.id) : hit.href;
  if (!path.startsWith("/")) return null;
  const kind = ref ? tabKindEntry(ref.kind) : null;
  return {
    key: `${hit.ref.pluginId}:${hit.ref.id}`, title: (thread ? shownThreadTitle(hit.title) : hit.title.trim()) || "Untitled", icon: thread ? "MessageSquare" : kind?.icon ?? hostIcon(hit.kind),
    kind: kind?.name ?? kindLabel(hit.kind), path, updatedAt: hit.updatedAt, ...(ref ? { ref } : {}), ...(found ? { found } : {}),
  };
}

export function omnibarDocuments(sources: { recents: readonly NewTabEntry[]; opened: readonly OpenedTab[]; entries: readonly NewTabEntry[]; hits: readonly SearchHit[]; searched: boolean }): LauncherDocument[] {
  const listed = [
    ...sources.entries.map((entry) => entryDocument(entry, sources.searched)),
    ...sources.hits.map((hit) => hitDocument(hit, sources.searched)),
    ...sources.recents.map((entry) => entryDocument(entry, false)),
    ...openedDocuments(sources.opened),
  ];
  return listed.filter((document): document is LauncherDocument => document !== null);
}
