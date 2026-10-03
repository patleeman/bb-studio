// The office door: which Space you're in, how much waits in the others, and
// the Space's settings. Like Notion's workspace menu, it is the only place
// BB's own Plugins, Skills and Automations rows live now.
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Icon } from "@bb-studio/kit/app";
import { openOffice } from "./routes";
import { requestCount, setCurrentSpaceId, useInboxCounts, useSpaces, type Space } from "./model";
import { COUNT, COUNT_HOT, MENU, MENU_ITEM, MENU_SEPARATOR, cn } from "./styles";

export interface SwitcherExtra {
  id: string;
  label: string;
  icon: string;
  run: () => void;
}

export function SpaceMark({ space, size = "md" }: { space: Pick<Space, "name" | "icon">; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-muted font-semibold leading-none",
        size === "md" ? "size-5 text-[13px]" : "size-4 text-[10px]",
      )}
    >
      {space.icon || space.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function SpaceSwitcher({ extras }: { extras: SwitcherExtra[] }) {
  const { spaces, current, loading } = useSpaces();
  const counts = useInboxCounts();
  const elsewhere = current
    ? spaces.filter((space) => space.id !== current.id).reduce((sum, space) => sum + requestCount(counts.data, space.id), 0)
    : 0;
  const allRequests = requestCount(counts.data, "all");

  const choose = (space: Space) => {
    setCurrentSpaceId(space.id);
    openOffice("");
  };

  return (
    <Menu.Root>
      <Menu.Trigger
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-sm font-semibold text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-sidebar-accent"
        aria-label={current ? `Space: ${current.name}. Switch space` : "Switch space"}
      >
        {current ? <SpaceMark space={current} /> : <span className="size-5 rounded-md bg-muted" />}
        <span className="min-w-0 flex-1 truncate text-left">{current?.name ?? (loading ? "" : "No space")}</span>
        {elsewhere > 0
          ? <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground" title={`${elsewhere} waiting in other spaces`}>
              <span aria-hidden className="size-1.5 rounded-full bg-warning-foreground" />{elsewhere}
            </span>
          : null}
        <Icon name="ChevronDown" aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={4} className={cn(MENU, "w-[var(--radix-dropdown-menu-trigger-width)] min-w-64")}>
          <Menu.Item className={MENU_ITEM} onSelect={() => openOffice("inbox/all")}>
            <Icon name="Inbox" aria-hidden />
            <span className="flex-1">Inbox · All spaces</span>
            {allRequests > 0 ? <span className={COUNT_HOT}>{allRequests}</span> : null}
          </Menu.Item>
          <Menu.Separator className={MENU_SEPARATOR} />
          <Menu.Label className="px-2 pt-1 pb-1 text-xs text-muted-foreground">Spaces</Menu.Label>
          {spaces.map((space) => {
            const waiting = requestCount(counts.data, space.id);
            return (
              <Menu.Item key={space.id} className={MENU_ITEM} onSelect={() => choose(space)}>
                <SpaceMark space={space} size="sm" />
                <span className="min-w-0 flex-1 truncate">{space.name}</span>
                {waiting > 0 ? <span className={COUNT}>{waiting}</span> : null}
                {space.id === current?.id ? <Icon name="Check" aria-label="Current space" /> : null}
              </Menu.Item>
            );
          })}
          <Menu.Item className={MENU_ITEM} onSelect={() => openOffice("spaces/new")}>
            <Icon name="Plus" aria-hidden />
            <span>New space</span>
          </Menu.Item>
          <Menu.Separator className={MENU_SEPARATOR} />
          <Menu.Item className={MENU_ITEM} onSelect={() => openOffice("settings")}>
            <Icon name="Settings" aria-hidden />
            <span>{current ? `${current.name} settings` : "Space settings"}</span>
          </Menu.Item>
          {extras.map((extra) => (
            <Menu.Item key={extra.id} className={MENU_ITEM} onSelect={extra.run}>
              <Icon name={extra.icon} aria-hidden />
              <span>{extra.label}</span>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

