// An open space's tab in the sidebar expands to what the space holds,
// sub-pages under their pages. A view over membership, so an item in two
// spaces shows under both; nothing moves here.
import { Icon, SIDEBAR_ROW, SidebarNote, cn, openAppPath } from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { rpcContract, SpaceTreeView } from "../contract";
import { itemAtPath } from "../tabs";
import { SidebarItemRow } from "./SidebarItemRow";
import { openCollectionQuery } from "./StudioPanel";

const COLLAPSED_KEY = "studio:sidebar-spaces-collapsed";
const REFETCH_DEBOUNCE_MS = 300;
/** Left padding of a member row, under the tab's icon, and per level below. */
const INDENT_PX = 28;
const LEVEL_PX = 12;

type Thread = SpaceTreeView["threads"][number];

export interface SpaceTree {
  spaces: SpaceTreeView[] | null;
  /** The last fetch failed; `spaces` is the tree from before, if any. */
  failed: boolean;
  retry(): void;
  expanded(id: string): boolean;
  toggle(id: string): void;
}

/** What the open space tabs hold. A space tab starts expanded; collapsing one is remembered. */
export function useSpaceTree(spaceIds: readonly string[]): SpaceTree {
  const rpc = useRpc<typeof rpcContract>();
  const [spaces, setSpaces] = useState<SpaceTreeView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [collapsed, toggle] = useCollapsed();
  const open = spaceIds.filter((id) => !collapsed.has(id));
  const key = open.join(" ");
  // Threads come only for expanded spaces, so expanding one refetches.
  const threadsFor = useRef<string[]>([]);
  threadsFor.current = open;
  const refetch = useCallback(() => {
    if (!threadsFor.current.length) return;
    rpc.call("spaceTree", { threadsFor: threadsFor.current }).then(
      (result) => {
        setSpaces(result.spaces);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [rpc]);
  useEffect(refetch, [refetch, key]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Members, titles and spaces change with any Studio change.
  useRealtime(STUDIO_REALTIME_CHANNEL, () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(refetch, REFETCH_DEBOUNCE_MS);
  });
  return { spaces, failed, retry: refetch, expanded: (id) => !collapsed.has(id), toggle };
}

/** Collapsed space ids, kept per browser. */
function useCollapsed(): [Set<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
      return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  return [collapsed, toggle];
}

/** Plain clicks navigate in place; modified ones keep the browser's behaviour. */
const plainClick = (event: MouseEvent, go: () => void) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  go();
};

function threadIcon(thread: Thread) {
  if (thread.status === "active" || thread.status === "starting") return "Loading";
  return thread.kind === "channel" ? "studio/hash" : thread.kind === "dm" ? "Bot" : "MessageSquare";
}

/** What an open space tab holds, nested under it: items, sub-items under their parents, then threads. */
export function SpaceMembers({ tree, spaceId, path, onNavigate }: { tree: SpaceTree; spaceId: string; path: string; onNavigate(): void }) {
  const navigate = useBbNavigate();
  const space = tree.spaces?.find((each) => each.id === spaceId);
  const open = (href: string) => {
    openAppPath(href);
    onNavigate();
  };
  if (!space) return tree.failed ? <FailedNote onRetry={tree.retry} /> : <Note>Loading…</Note>;
  const current = itemAtPath(space.items, path);
  const more = space.itemCount - space.items.length;
  const moreThreads = (space.threadCount ?? 0) - space.threads.length;
  return (
    <div className="flex flex-col gap-px" data-studio-space={space.id}>
      {tree.failed ? <FailedNote onRetry={tree.retry} /> : null}
      {space.items.map((item) => (
        <SidebarItemRow
          key={`${item.pluginId}:${item.id}`}
          id={item.id}
          href={item.href}
          title={item.title}
          kindIcon={item.kindIcon}
          glyph={item.icon}
          selected={item === current}
          style={{ paddingLeft: INDENT_PX + item.depth * LEVEL_PX }}
          onOpen={() => open(item.href)}
        />
      ))}
      {more > 0 ? (
        <MoreRow
          label={`${more} more`}
          href="/plugins/studio/studio"
          onOpen={() => {
            openCollectionQuery(navigate, { filters: [{ field: "space", value: space.name }], text: "" });
            onNavigate();
          }}
        />
      ) : null}
      {space.threads.map((thread) => (
        <a
          key={thread.id}
          href={`/threads/${encodeURIComponent(thread.id)}`}
          className={SIDEBAR_ROW}
          style={{ paddingLeft: INDENT_PX }}
          onClick={(event) =>
            plainClick(event, () => {
              navigate.toThread(thread.id);
              onNavigate();
            })
          }
        >
          <Icon name={threadIcon(thread)} className="size-4 shrink-0 text-subtle-foreground" />
          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
        </a>
      ))}
      {moreThreads > 0 ? <MoreRow label={`${moreThreads} more threads`} href={space.href} onOpen={open} /> : null}
      {space.threadCount === null ? <Note>Loading threads…</Note> : null}
      {!space.items.length && space.threadCount === 0 ? <Note>Nothing in this space yet</Note> : null}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex h-7 items-center text-xs text-subtle-foreground/60" style={{ paddingLeft: INDENT_PX + 8 }}>
      {children}
    </p>
  );
}

function FailedNote({ onRetry }: { onRetry(): void }) {
  return (
    <SidebarNote tone="danger">
      Couldn't load spaces.
      <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onRetry}>
        Retry
      </button>
    </SidebarNote>
  );
}

function MoreRow({ label, href, onOpen }: { label: string; href: string; onOpen(href: string): void }) {
  return (
    <a href={href} className={cn(SIDEBAR_ROW, "text-xs text-subtle-foreground")} style={{ paddingLeft: INDENT_PX + 24 }} onClick={(event) => plainClick(event, () => onOpen(href))}>
      + {label}
    </a>
  );
}
