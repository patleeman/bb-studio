// The top of the Bot sidebar (round 7, 7a/7b): the Bot's space header, a
// band of its own (BB's sidebar color and a bottom border; under a scene theme
// no band, as the sidebar is one glass card) with its avatar (36px),
// its name, a status line ("2 running", "Paused", "Paused · in bb" for a
// Bot a BB Studio copy imported and doesn't run, or nothing), and a ···
// menu (Edit space…, Default model: what its new conversations start on,
// Archive: the older page, New Bot); then the Bot's pages as rows: Memory, Library,
// Automations and Todos (the primary Bot's, with Todos on; the count is what
// needs Patrick now). The row of the page on screen is selected.
import type { ReactNode } from "react";
import type { BotSpace } from "../../bot-threads-contract";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Icon } from "../../kit/app/index";
import { BotPresence } from "../../presence/ui/BotPresence";
import { dragSourceProps, refDragItem } from "../../kit/app/item-drag";
import type { TabKindId } from "../../tab-kinds";

export const STUDIO_ROOT_PATH = "/plugins/studio/studio";
export const AUTOMATIONS_PATH = "/plugins/studio/automations";

export type SpacePage = "memory" | "skills" | "library" | "automations" | "todos";

/** Which of the Bot's pages the main view shows, if any. */
export function spacePageAt(pathname: string): SpacePage | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === STUDIO_ROOT_PATH) return "library";
  if (/^\/plugins\/studio\/studio\/memory(?:\/|$)/.test(path)) return "memory";
  if (/^\/plugins\/studio\/studio\/skills(?:\/|$)/.test(path)) return "skills";
  if (path === AUTOMATIONS_PATH || path.startsWith(`${AUTOMATIONS_PATH}/`)) return "automations";
  if (/^\/plugins\/studio\/studio\/bot\/[^/]+\/loops$/.test(path)) return "todos";
  return null;
}

/**
 * The line under the Bot's name: its status, no model (each conversation
 * has its own). "Paused · in bb" for a Bot a BB Studio copy imported and
 * doesn't run (the Info tab's and automations' rule), "Paused", "Stopped",
 * else how many of its threads run; null when there is nothing to say.
 */
export function spaceLine(bot: { state: string; inBb?: boolean } | null | undefined, running: number): string | null {
  if (bot?.inBb) return "Paused · in bb";
  if (bot?.state === "paused") return "Paused";
  if (bot?.state === "stopped") return "Stopped";
  return running ? `${running} running` : null;
}

function SpaceLine({ line }: { line: string | null }) {
  if (!line) return null;
  return <span data-testid="bot-sidebar-line" className="truncate text-xs text-muted-foreground">{line}</span>;
}

const PAGE_ROW = "flex h-7 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-foreground/85 outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-state-active aria-[current=page]:text-foreground";
const MENU_BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-state-active";

export interface SpaceMenu {
  editSpace(): void;
  defaultModel(): void;
  /** The Bot's older and finished conversations and workers (the older page). */
  archive(): void;
  newBot(): void;
}

export function SpaceHeader({ bot, line, glass, page, todos, onPage, menu }: {
  bot: BotSpace | null;
  line: string | null;
  /** Under a scene theme: no band, border or sticking, so the sidebar reads as one card. */
  glass: boolean;
  page: SpacePage | null;
  /** Todos' count, or null where the Bot has no Todos page. */
  todos: number | null;
  onPage(page: SpacePage): void;
  menu: SpaceMenu;
}) {
  // Each row drags as its page (src/tab-kinds.ts), for the workbench: a drop opens that page as a tab.
  const row = (id: SpacePage, label: string, glyph: ReactNode, extra?: ReactNode) => (
    <button key={id} type="button" data-testid={`space-page-${id}`} aria-current={page === id || (id === "todos" && page === "automations") ? "page" : undefined} onClick={() => onPage(id)} className={PAGE_ROW}
      {...dragSourceProps(bot ? refDragItem({ kind: id satisfies TabKindId, id: bot.id }, label) : null)}>
      <span aria-hidden className="flex w-4 shrink-0 justify-center text-muted-foreground">{glyph}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra}
    </button>
  );
  return (
    <header data-studio-no-drag="all" data-testid="bot-sidebar-header" className={glass ? "-mx-1.5 flex shrink-0 flex-col px-2 pb-2 pt-1.5" : "sticky top-0 z-10 -mx-1.5 flex shrink-0 flex-col border-b border-border px-2 pb-2 pt-1.5"} style={glass ? undefined : { background: "var(--sidebar, var(--background))" }}>
      <div className="flex items-center gap-2.5 px-1">
        {bot ? <BotPresence bot={bot} size={36} /> : <span className="size-9" />}
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 data-testid="bot-sidebar-name" className="truncate text-[15px] font-semibold leading-tight text-foreground">{bot?.name ?? ""}</h2>
          <SpaceLine line={line} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="bot-menu" className={MENU_BUTTON} aria-label="Bot menu"><Icon name="MoreHorizontal" className="size-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!bot} onSelect={menu.editSpace}>Edit space…</DropdownMenuItem>
            <DropdownMenuItem disabled={!bot} onSelect={menu.defaultModel}>Default model</DropdownMenuItem>
            <DropdownMenuItem disabled={!bot} onSelect={menu.archive}>Archive</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={menu.newBot}>New Bot</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <nav aria-label="Bot pages" className="mt-2 flex flex-col gap-px">
        {row("memory", "Memory", <span className="text-sm leading-none">◈</span>)}
        {row("skills", "Skills", <Icon name="BookOpen" className="size-4" />)}
        {row("library", "Library", <Icon name="studio/library" className="size-4" />)}
        {todos !== null
          ? row("todos", "Todos", <Icon name="ListTodo" className="size-4" />, todos > 0 ? <span data-testid="space-todos-count" className="shrink-0 text-xs tabular-nums text-warning">{todos}</span> : null)
          : row("automations", "Todos", <Icon name="ListTodo" className="size-4" />)}
      </nav>
    </header>
  );
}
