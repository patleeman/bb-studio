// The Spaces group of the sidebar's Studio section: each space as a row that
// expands to what it holds, sub-pages under their pages. A view over
// membership, so an item in two spaces shows under both; nothing moves here.
import { Icon, SIDEBAR_ROW, SIDEBAR_ROW_SELECTED, SidebarGroupHeading, cn, openAppPath } from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { rpcContract, SpaceTreeView } from "../contract";
import { itemAtPath } from "../tabs";
import { SpaceGlyph, spaceHref } from "./Spaces";

const EXPANDED_KEY = "studio:sidebar-spaces-expanded";
const REFETCH_DEBOUNCE_MS = 300;
/** Left padding of a member row, past the space's chevron, and per level below. */
const INDENT_PX = 28;
const LEVEL_PX = 12;

type Thread = SpaceTreeView["threads"][number];

export function useSpaceTree(enabled: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [spaces, setSpaces] = useState<SpaceTreeView[] | null>(null);
  const refetch = useCallback(() => {
    // A failed refresh keeps the last tree; the tabs below show the error.
    rpc.call("spaceTree", null).then((result) => setSpaces(result.spaces), () => {});
  }, [rpc]);
  useEffect(() => {
    if (enabled) refetch();
  }, [enabled, refetch]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Members, titles and spaces change with any Studio change.
  useRealtime(STUDIO_REALTIME_CHANNEL, () => {
    if (!enabled) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(refetch, REFETCH_DEBOUNCE_MS);
  });
  return spaces;
}

/** Expanded space ids, kept per browser. */
function useExpanded(): [Set<string>, (id: string) => void] {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]");
      return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  return [expanded, toggle];
}

/** Plain clicks navigate in place; modified ones keep the browser's behaviour. */
const plainClick = (event: MouseEvent, go: () => void) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  go();
};

function threadIcon(thread: Thread) {
  if (thread.status === "active" || thread.status === "starting") return "Loader";
  return thread.kind === "channel" ? "Hash" : thread.kind === "dm" ? "Bot" : "MessageSquare";
}

export function SidebarSpaces({ spaces, path, onNavigate }: { spaces: readonly SpaceTreeView[]; path: string; onNavigate(): void }) {
  const [expanded, toggle] = useExpanded();
  const navigate = useBbNavigate();
  if (!spaces.length) return null;
  const open = (href: string) => {
    openAppPath(href);
    onNavigate();
  };
  return (
    <div className="flex flex-col gap-px">
      <SidebarGroupHeading>Spaces</SidebarGroupHeading>
      {spaces.map((space) => {
        const isOpen = expanded.has(space.id);
        const current = itemAtPath(space.items, path);
        const more = space.itemCount - space.items.length;
        const moreThreads = space.threadCount - space.threads.length;
        return (
          <div key={space.id} className="flex flex-col gap-px" data-studio-space={space.id}>
            <div className="relative">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${space.name}`}
                className="absolute top-1/2 left-0.5 z-10 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                onClick={() => toggle(space.id)}
              >
                <Icon name="ChevronRight" aria-hidden className={cn("size-3 transition-transform duration-150", isOpen && "rotate-90")} />
              </button>
              <a
                href={space.href}
                aria-current={path === space.href ? "page" : undefined}
                className={cn(SIDEBAR_ROW, "pl-7", path === space.href && SIDEBAR_ROW_SELECTED)}
                onClick={(event) => plainClick(event, () => open(space.href))}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <SpaceGlyph space={space} className="text-sm leading-none" />
                </span>
                <span className="min-w-0 flex-1 truncate">{space.name}</span>
                {space.itemCount + space.threadCount ? <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">{space.itemCount + space.threadCount}</span> : null}
              </a>
            </div>
            {isOpen ? (
              <>
                {space.items.map((item) => (
                  <a
                    key={`${item.pluginId}:${item.id}`}
                    href={item.href}
                    aria-current={item === current ? "page" : undefined}
                    className={cn(SIDEBAR_ROW, item === current && SIDEBAR_ROW_SELECTED)}
                    style={{ paddingLeft: INDENT_PX + item.depth * LEVEL_PX }}
                    onClick={(event) => plainClick(event, () => open(item.href))}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-subtle-foreground">
                      {item.icon ? <span className="text-sm leading-none">{item.icon}</span> : <Icon name={item.kindIcon} className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  </a>
                ))}
                {more > 0 ? <MoreRow label={`${more} more`} href={`${spaceHref(space.id)}/items`} onOpen={open} /> : null}
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
                {!space.items.length && !space.threads.length ? (
                  <p className="m-0 flex h-7 items-center text-xs text-subtle-foreground/60" style={{ paddingLeft: INDENT_PX + 8 }}>
                    Empty
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MoreRow({ label, href, onOpen }: { label: string; href: string; onOpen(href: string): void }) {
  return (
    <a href={href} className={cn(SIDEBAR_ROW, "text-xs text-subtle-foreground")} style={{ paddingLeft: INDENT_PX + 24 }} onClick={(event) => plainClick(event, () => onOpen(href))}>
      + {label}
    </a>
  );
}
