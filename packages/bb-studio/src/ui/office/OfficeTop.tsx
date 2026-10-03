// The top of the sidebar: the address bar, then Essentials. The bar says where
// you are in words (Space › thing), never an address; click it or press ⌘T to
// search, open or create. Essentials are big tiles that never archive.
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  useBbContext,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb-studio/kit/app";
import { CommandBar, openCommandBar } from "./CommandBar";
import { useLocationHref } from "./location";
import { useSpaces } from "./model";
import { Hint } from "./ProviderBadge";
import { TabGlyph, openTab } from "./TabRow";
import { isTabActive, useTabActions, useTabs, type ShownTab } from "./tabs";
import { MENU, MENU_ITEM, MENU_SEPARATOR, PORTAL_SCOPE, cn } from "./styles";

function AddressBar({ where }: { where: string | null }) {
  const { current } = useSpaces();
  return (
    <button
      type="button"
      onClick={() => openCommandBar()}
      aria-label={where ? `${where}. Search or open` : "Search or open"}
      className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg bg-sidebar-accent/70 px-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Icon name="Search" aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
      <span className="min-w-0 flex-1 truncate">
        {where
          ? <>{current ? <span className="text-subtle-foreground">{current.name} › </span> : null}<span className="text-foreground">{where}</span></>
          : "Search or start something"}
      </span>
      <kbd className="shrink-0 font-sans text-xs text-subtle-foreground">⌘T</kbd>
    </button>
  );
}

function EssentialTile({ tab, active, onRemove }: { tab: ShownTab; active: boolean; onRemove: () => void }) {
  const threadActions = useSidebarThreadActions();
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className="relative">
          <Hint label={tab.title}>
            <button
              type="button"
              aria-label={[tab.title, tab.badge ? `${tab.badge} waiting` : null, tab.needsYou ? "needs you" : null, tab.unread ? "unread" : null].filter(Boolean).join(", ")}
              aria-current={active ? "page" : undefined}
              onClick={(event) => openTab(tab, threadActions, { split: event.metaKey || event.ctrlKey })}
              className={cn(
                "flex h-12 w-full items-center justify-center rounded-lg bg-sidebar-accent/70 transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring",
                active && "bg-background shadow-sm ring-1 ring-border/60 hover:bg-background",
              )}
            >
              <TabGlyph tab={tab} size="md" />
            </button>
          </Hint>
          {tab.badge
            ? <span aria-hidden className="pointer-events-none absolute top-1 right-1 min-w-4 rounded-full bg-foreground px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-background">{tab.badge}</span>
            : tab.needsYou || tab.unread
              ? <span aria-hidden className={cn("pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full", tab.needsYou ? "bg-warning-foreground" : "bg-foreground")} />
              : null}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content {...PORTAL_SCOPE} className={MENU}>
          {tab.thread ? <ContextMenu.Item onSelect={() => openTab(tab, threadActions, { split: true })} className={MENU_ITEM}><Icon name="Columns2" aria-hidden />Open in split</ContextMenu.Item> : null}
          {tab.thread ? <ContextMenu.Separator className={MENU_SEPARATOR} /> : null}
          <ContextMenu.Item onSelect={onRemove} className={MENU_ITEM}><Icon name="Star" aria-hidden />Remove from Essentials</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function OfficeTop(_props: ExperimentalSidebarNavigationProps) {
  const { current } = useSpaces();
  const spaceId = current?.id ?? null;
  const { threadId } = useBbContext();
  const locationHref = useLocationHref();
  const tabs = useTabs(spaceId);
  const actions = useTabActions(spaceId, tabs.refresh);

  const all = [...tabs.essentials, ...tabs.pinned, ...tabs.today];
  const here = all.find((tab) => isTabActive(tab, threadId, locationHref));
  const where = here?.title ?? (threadId ? tabs.threads.find((thread) => thread.id === threadId)?.displayTitle ?? null : null);

  return (
    <nav aria-label="Office" className="shrink-0 space-y-2 px-2 pt-1 pb-1">
      <AddressBar where={where} />
      {tabs.essentials.length
        ? <div className="grid grid-cols-4 gap-1.5">
            {tabs.essentials.map((tab) => (
              <EssentialTile key={tab.ref} tab={tab} active={isTabActive(tab, threadId, locationHref)} onRemove={() => actions.move(tab.ref, "pinned")} />
            ))}
          </div>
        : null}
      <CommandBar spaceId={spaceId} tabs={all} />
    </nav>
  );
}
