// The top of the Bot sidebar (round 7, 7a/7b): the Bot's space header, a
// band of its own (BB's sidebar color and a bottom border; under a scene theme
// no band, as the sidebar is one glass card) with its avatar (36px),
// its name, a status line ("2 running", "Paused · Resume", "Stopped · Resume",
// "Paused · in bb · Run here" for a Bot a BB Studio copy imported and doesn't
// run, or nothing; Resume and Run here are buttons), and a ··· menu (Resume
// <name> while it is paused or stopped, Edit <name>…, Bot settings…: its
// Controls page, Default model: what its new conversations start on, New
// Bot); then the Bot's pages as rows: Memory, Skills,
// Library and Conversations (every conversation, active and archived, with search). The
// row of the page on screen is selected.
import type { ReactNode } from "react";
import type { BotSpace } from "../../bot-threads-contract";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Icon } from "../../kit/app/index";
import { BotPresence } from "../../presence/ui/BotPresence";
import { dragSourceProps, refDragItem } from "../../kit/app/item-drag";
import type { TabKindId } from "../../tab-kinds";
export { resumeWord } from "../bot/bot-state";

export const STUDIO_ROOT_PATH = "/plugins/studio/studio";
export const AUTOMATIONS_PATH = "/plugins/studio/automations";

export type SpacePage = "memory" | "skills" | "library" | "automations" | "conversations";

/** Which of the Bot's pages the main view shows, if any. */
export function spacePageAt(pathname: string): SpacePage | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === STUDIO_ROOT_PATH) return "library";
  if (/^\/plugins\/studio\/studio\/memory(?:\/|$)/.test(path)) return "memory";
  if (/^\/plugins\/studio\/studio\/skills(?:\/|$)/.test(path)) return "skills";
  if (path === AUTOMATIONS_PATH || path.startsWith(`${AUTOMATIONS_PATH}/`)) return "automations";
  if (/^\/plugins\/studio\/studio\/conversations(?:\/|$)/.test(path)) return "conversations";
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

function SpaceLine({ line, resume, onResume, onChooseModel }: { line: string | null; resume: string | null; onResume?: () => void; onChooseModel?: () => void }) {
  if (!line) return null;
  return (
    <span data-testid="bot-sidebar-status" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <span data-testid="bot-sidebar-line" className="truncate" title={line}>{line}</span>
      {onChooseModel ? <>
        <span aria-hidden>·</span>
        <button type="button" data-testid="bot-sidebar-choose-model" onClick={onChooseModel} className="shrink-0 rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Choose a model</button>
      </> : null}
      {resume && onResume ? <>
        <span aria-hidden>·</span>
        <button type="button" data-testid="bot-sidebar-resume" onClick={onResume} className="shrink-0 rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{resume}</button>
      </> : null}
    </span>
  );
}

const PAGE_ROW = "flex h-7 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-foreground/85 outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-state-active aria-[current=page]:text-foreground";
const MENU_BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-state-active";

export interface SpaceMenu {
  /** Turns a paused or stopped Bot back on (bot_resume). */
  resume?(): void;
  editSpace(): void;
  botSettings(): void;
  defaultModel(): void;
  newBot(): void;
}

export function SpaceHeader({ bot, line, resume = null, chooseModel = false, glass, page, onPage, menu }: {
  /** Its new Main can't start for want of a model: Choose a model after the line opens its Default model. */
  chooseModel?: boolean;
  bot: BotSpace | null;
  line: string | null;
  /** The Bot's resume word (resumeWord) while it is paused or stopped: a button after the line and the menu's first item. */
  resume?: string | null;
  /** Under a scene theme: no band, border or sticking, so the sidebar reads as one card. */
  glass: boolean;
  page: SpacePage | null;
  onPage(page: SpacePage): void;
  menu: SpaceMenu;
}) {
  // Each row drags as its page (src/tab-kinds.ts), for the workbench: a drop opens that page as a tab.
  const row = (id: SpacePage, label: string, glyph: ReactNode, extra?: ReactNode) => (
    <button key={id} type="button" data-testid={`space-page-${id}`} aria-current={page === id ? "page" : undefined} onClick={() => onPage(id)} className={PAGE_ROW}
      {...dragSourceProps(bot ? refDragItem({ kind: (id === "conversations" ? "archive" : id) satisfies TabKindId, id: bot.id }, label) : null)}>
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
          <SpaceLine line={line} resume={resume} onResume={menu.resume} {...(chooseModel && bot ? { onChooseModel: menu.defaultModel } : {})} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="bot-menu" className={MENU_BUTTON} aria-label="Bot menu"><Icon name="MoreHorizontal" className="size-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {bot && resume && menu.resume ? <>
              <DropdownMenuItem data-testid="bot-menu-resume" onSelect={menu.resume}>{resume === "Resume" ? `Resume ${bot.name}` : `Run ${bot.name} here`}</DropdownMenuItem>
              <DropdownMenuSeparator />
            </> : null}
            <DropdownMenuItem disabled={!bot} onSelect={menu.editSpace}>{bot ? `Edit ${bot.name}…` : "Edit…"}</DropdownMenuItem>
            <DropdownMenuItem disabled={!bot} onSelect={menu.botSettings}>Bot settings…</DropdownMenuItem>
            <DropdownMenuItem disabled={!bot} onSelect={menu.defaultModel}>Default model</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={menu.newBot}>New Bot</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <nav aria-label="Bot pages" className="mt-2 flex flex-col gap-px">
        {row("memory", "Memory", <span className="text-sm leading-none">◈</span>)}
        {row("skills", "Skills", <Icon name="Toolbox" className="size-4" />)}
        {row("library", "Library", <Icon name="studio/library" className="size-4" />)}
        {row("conversations", "Conversations", <Icon name="studio/conversations" className="size-4" />)}
      </nav>
    </header>
  );
}
