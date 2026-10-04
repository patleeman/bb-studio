// A Space's Studio tab beside its lead: the items that aren't open, as cards
// with a thumbnail or a glimpse of their text. Opening one opens it beside the
// lead, where it lists as open in the sidebar.
import { Icon, PAGE_TITLE, PILL, THUMBNAIL } from "@bb-studio/kit/app";
import { relativeTime } from "@bb-studio/kit/format";
import { useBbNavigate, useRealtime, useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { rpcContract } from "../../contract";
import { TABS_CHANNEL } from "../../ids";
import { useSpaceLead, useSpaceOf, useSpaceOverview, type OverviewItem } from "./data";
import { NewInSpaceMenu } from "./NewInSpace";
import { openItemTab } from "./tabs";

const ALL = "all";

function useOpenRefs(): ReadonlySet<string> | null {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState<ReadonlySet<string> | null>(null);
  const refresh = useCallback(() => {
    rpc.call("tabs", null).then(({ tabs }) => setOpen(new Set(tabs.map((tab) => `${tab.pluginId}:${tab.id}`))), () => setOpen(new Set()));
  }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime(TABS_CHANNEL, refresh);
  return open;
}

function ItemCard({ item, onOpen }: { item: OverviewItem; onOpen(): void }) {
  const glyph = item.icon
    ? <span className="text-base leading-none">{item.icon}</span>
    : <Icon name={item.kindIcon} className="size-4 text-muted-foreground" />;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-space-studio-card={item.ref}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-left transition-colors hover:border-foreground/20 hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="flex h-32 items-center justify-center overflow-hidden border-b border-border bg-muted/40 p-3">
        {item.thumbnailUrl
          ? <img src={item.thumbnailUrl} alt="" loading="lazy" className={THUMBNAIL} />
          : item.preview
            ? <p className="line-clamp-5 w-full self-start text-xs leading-relaxed text-muted-foreground">{item.preview}</p>
            : <span className="flex size-10 items-center justify-center rounded-lg bg-background">{item.icon ? <span className="text-2xl leading-none">{item.icon}</span> : <Icon name={item.kindIcon} className="size-5 text-muted-foreground" />}</span>}
      </div>
      <div className="flex min-w-0 flex-col gap-1 px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-4 shrink-0 items-center justify-center">{glyph}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {item.kindLabel} · {relativeTime(item.updatedAt)}{item.updatedBy === "agent" ? " · by an agent" : ""}
        </span>
      </div>
    </button>
  );
}

/** The Space's Studio items that aren't open, as cards. */
export function SpaceItemsTab({ threadId }: PluginThreadPanelProps) {
  const spaceId = useSpaceOf()(threadId);
  const lead = useSpaceLead(spaceId);
  const overview = useSpaceOverview(spaceId);
  const navigate = useBbNavigate();
  const open = useOpenRefs();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState(ALL);
  const closed = useMemo(() => (overview.data?.items ?? []).filter((item) => !open?.has(item.ref)), [overview.data, open]);
  const kinds = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const item of closed) counts.set(item.kind, { label: item.kindLabel, count: (counts.get(item.kind)?.count ?? 0) + 1 });
    return [...counts].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.count - a.count);
  }, [closed]);
  if (!spaceId) return <p className="p-4 text-sm text-muted-foreground">This thread isn't in a Space.</p>;
  const name = lead.data?.name ?? "this Space";
  const needle = query.trim().toLowerCase();
  const shown = closed.filter((item) => (kind === ALL || item.kind === kind) && (!needle || item.title.toLowerCase().includes(needle) || item.preview?.toLowerCase().includes(needle)));
  const loading = !overview.data || !open;
  const total = overview.data?.items.length ?? 0;
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{name}</p>
          <h1 className={PAGE_TITLE}>Studio</h1>
        </div>
        <NewInSpaceMenu spaceId={spaceId} onCreated={(item) => openItemTab(navigate, item)} />
      </header>
      {closed.length ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {kinds.length > 1 ? (
            <div role="group" aria-label="Kind" className="flex flex-wrap items-center gap-1">
              <button type="button" aria-pressed={kind === ALL} className={PILL} onClick={() => setKind(ALL)}>All <span className="ml-1 tabular-nums opacity-70">{closed.length}</span></button>
              {kinds.map((each) => (
                <button key={each.id} type="button" aria-pressed={kind === each.id} className={PILL} onClick={() => setKind(each.id)}>
                  {each.label} <span className="ml-1 tabular-nums opacity-70">{each.count}</span>
                </button>
              ))}
            </div>
          ) : null}
          <label className="relative ml-auto w-full max-w-60 min-w-40 flex-1">
            <Icon name="Search" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter"
              aria-label="Filter items"
              className="h-8 w-full rounded-md border border-border bg-background pr-3 pl-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>
      ) : null}
      {shown.length ? (
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {shown.map((item) => <ItemCard key={item.ref} item={item} onOpen={() => openItemTab(navigate, item)} />)}
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <Icon name="Layers" className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…"
              : closed.length ? "Nothing matches."
                : total ? `Everything in ${name} is open in the sidebar.`
                  : `No pages, drawings or tables yet. Anything you make here stays in ${name}.`}
          </p>
        </div>
      )}
    </div>
  );
}
