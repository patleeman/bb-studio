// An add-on's collection in a thread's side panel: the items made in or
// linked to this thread, then the project's recent ones. Opening one shows it
// in place; New makes one in the thread's project and links it to the thread.
import { useRealtime, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { STUDIO_PLUGIN_ID, type StudioSchemas } from "../contract";
import { errorMessage, relativeTime, untitled } from "../format";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import { ItemTile, PRIMARY_BUTTON, THUMBNAIL } from "./pieces";
import { studioItemProps } from "./studio-item";

type Provider = StudioSchemas["provider"];
type Item = z.output<Provider["studio_list"]["output"]>["items"][number];
type Kind = z.output<Provider["studio_describe"]["output"]>["kinds"][number];

const RECENT = 20;

const threadLinks = z.object({ threads: z.array(z.object({ ref: z.object({ pluginId: z.string(), id: z.string() }) })) });

export function ThreadItemsPanel({
  threadId,
  pluginId,
  kind: kindId,
  channel,
  initialId = null,
  linkedIds,
  renderItem,
}: {
  threadId: string;
  pluginId: string;
  /** The provider kind this tab lists and makes. */
  kind: string;
  /** The add-on's realtime channel, to refetch on changes. */
  channel: string;
  /** An item to open straight away. */
  initialId?: string | null;
  /** Items that belong to this thread besides the ones Studio links. */
  linkedIds?: readonly string[];
  renderItem(id: string, options: { backLabel: string; onBack(): void }): ReactNode;
}) {
  const rpc = useRpc<Provider>();
  const sdk = useSdk();
  const [openId, setOpenId] = useState(initialId);
  // BB keeps this tab mounted when another tab of the same kind opens with a
  // different item, so a new item to open replaces the one on screen.
  const [openedWith, setOpenedWith] = useState(initialId);
  if (openedWith !== initialId) {
    setOpenedWith(initialId);
    setOpenId(initialId);
  }
  const [kind, setKind] = useState<Kind | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [thread, setThread] = useState<{ projectId: string | null; status: string } | null>(null);
  const projectId = thread?.projectId ?? null;
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useRealtime(channel, () => setRefreshKey((current) => current + 1));

  useEffect(() => {
    let live = true;
    sdk.threads.get({ threadId }).then(
      (found) => live && setThread({ projectId: found.projectId ?? null, status: found.status }),
      () => live && setThread({ projectId: null, status: "idle" }),
    );
    return () => {
      live = false;
    };
  }, [sdk, threadId]);

  const linksFor = useCallback(
    () =>
      // Without Studio there are no links; the tab still lists recent items.
      sdk.plugins
        .callRpc({ pluginId: STUDIO_PLUGIN_ID, method: "threadItems", input: { threadId }, outputSchema: threadLinks })
        .then(({ threads }) => new Set(threads.filter((each) => each.ref.pluginId === pluginId).map((each) => each.ref.id)))
        .catch(() => new Set<string>()),
    [sdk, threadId, pluginId],
  );

  useEffect(() => {
    let live = true;
    Promise.all([rpc.call("studio_describe", null), rpc.call("studio_list", null), linksFor()]).then(
      ([info, list, links]) => {
        if (!live) return;
        setKind(info.kinds.find((each) => each.id === kindId) ?? null);
        setItems(list.items.filter((item) => item.kind === kindId && !item.template));
        setLinked(links);
      },
      (cause: unknown) => live && toast.error(errorMessage(cause)),
    );
    return () => {
      live = false;
    };
  }, [rpc, kindId, linksFor, refreshKey, openId]);

  const create = async () => {
    setCreating(true);
    try {
      const { item } = await rpc.call("studio_create", { kind: kindId, projectId });
      const now = Date.now();
      await sdk.plugins
        .callRpc({
          pluginId: STUDIO_PLUGIN_ID,
          method: "linkItemThread",
          input: { thread: { threadId, ref: { pluginId, id: item.id }, role: "created", state: thread?.status ?? "idle", createdAt: now, updatedAt: now, metadata: {} } },
          outputSchema: z.object({ ok: z.boolean() }),
        })
        .catch(() => {});
      setOpenId(item.id);
    } catch (cause) {
      toast.error(`Couldn't create a ${kind?.label.toLowerCase() ?? "new item"}: ${errorMessage(cause)}`);
    } finally {
      setCreating(false);
    }
  };

  const sections = useMemo(() => {
    const live = (items ?? []).filter((item) => !item.archived).sort((a, b) => b.updatedAt - a.updatedAt);
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      const matches = live.filter((item) => words.every((word) => `${item.title} ${item.preview ?? ""}`.toLowerCase().includes(word)));
      return [{ title: "Results", items: matches }];
    }
    const mine = new Set([...linked, ...(linkedIds ?? [])]);
    const here = live.filter((item) => mine.has(item.id));
    const recent = live.filter((item) => !mine.has(item.id) && (!projectId || !item.projectId || item.projectId === projectId)).slice(0, RECENT);
    return [
      { title: "This thread", items: here },
      { title: "Recent", items: recent },
    ].filter((section) => section.items.length);
  }, [items, linked, linkedIds, projectId, query]);

  const plural = kind?.plural ?? "Items";
  if (openId) return <>{renderItem(openId, { backLabel: plural, onBack: () => setOpenId(null) })}</>;
  return (
    <div className="studio-root flex h-full flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
        <div className="relative min-w-0 flex-1">
          <Icon name="Search" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-8 w-full rounded-md border border-border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
            placeholder={`Search ${plural.toLowerCase()}…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={PRIMARY_BUTTON}
          // New waits for the thread, so the item lands in its project.
          disabled={creating || !thread || !kind?.create || kind.create.mode !== "rpc"}
          onClick={() => void create()}
        >
          <Icon name="Plus" />
          New
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {items === null ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
        ) : sections.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            {query ? "Nothing matches." : `No ${plural.toLowerCase()} yet. New makes one for this thread.`}
          </p>
        ) : (
          sections.map((section) => (
            <section key={section.title} className="mb-3">
              <h3 className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{section.title}</h3>
              <ul className="flex flex-col">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <ItemRow item={item} kind={kind} onOpen={() => setOpenId(item.id)} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function ItemRow({ item, kind, onOpen }: { item: Item; kind: Kind | null; onOpen(): void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-state-hover"
      onClick={onOpen}
      {...studioItemProps({ href: item.href, title: untitled(item.title), icon: kind?.icon })}
    >
      {item.thumbnailUrl && !failed ? (
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
          <img src={item.thumbnailUrl} alt="" loading="lazy" className={cn(THUMBNAIL, "p-0.5")} onError={() => setFailed(true)} />
        </span>
      ) : (
        <ItemTile icon={item.icon} kindIcon={kind?.icon ?? "GridView"} />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", !item.title.trim() && "text-muted-foreground")}>{untitled(item.title)}</span>
        {item.preview ? <span className="block truncate text-xs text-muted-foreground">{item.preview}</span> : null}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.updatedAt)}</span>
    </button>
  );
}
