// The one layout of a Bot's pages (Todos, Memory, Library, Automations,
// Archive): the header row "<Page> · <Bot>" with the page's actions on the
// right (PageBar, in BB's title bar where it lends one), then one scrolling
// column of the same width and margins on every page, holding the toolbar
// and the page's groups of rows. A row opens its item in the workbench
// beside the page (open-row.ts).
import type { ReactNode } from "react";
import { openAppPath } from "../../kit/app/index";
import { botPath } from "../bot/selection";
import { PageBar } from "../page-bar";

/**
 * The column's card under a scene theme: the host paints an element marked
 * `data-fork-card="main"` as its main glass card. It is the column's 832 px
 * of content plus 24 px on each side, as tall as the page area, and stays
 * put while the column scrolls over it. With no card layout it draws nothing.
 */
export const BOT_PAGE_CARD_BOX = "mx-auto w-full max-w-[880px]";
export const BOT_PAGE_CARD = `pointer-events-none sticky top-0 -z-10 -mb-[100cqh] h-[100cqh] ${BOT_PAGE_CARD_BOX}`;

/** The content column every Bot page shares: its width and margins. */
export const BOT_PAGE_COLUMN = "mx-auto flex w-full max-w-4xl flex-col gap-5 px-8 pt-5 pb-16 @max-2xl/bot-page:px-4";

export interface BotPageLayoutProps {
  /** The page's name: "Todos", "Memory", "Library", "Automations", "Archive". */
  title: string;
  /** The Bot the page shows, after the title. */
  bot?: string | null;
  /** The Bot's id: its name in the header opens the Bot's page. */
  botId?: string | null;
  /** The header's actions, on the right. */
  actions?: ReactNode;
  /** The page's BotPageToolbar. */
  toolbar?: ReactNode;
  testId?: string;
  children?: ReactNode;
}

export function BotPageLayout({ title, bot, botId, actions, toolbar, testId, children }: BotPageLayoutProps) {
  const botDetail = !bot ? undefined : botId
    ? <button type="button" data-testid="bot-page-bot" onClick={() => openAppPath(botPath(botId))} className="max-w-full truncate rounded hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{bot}</button>
    : bot;
  return (
    <div data-testid={testId} data-bot-page={title} className="studio-root @container/bot-page flex h-full min-h-0 w-full flex-1 flex-col bg-background text-foreground">
      <PageBar title={title} actions={actions} detail={botDetail} column />
      <div className="relative flex min-h-0 flex-1 [container-type:size]">
        <div data-bot-page-scroll="" data-fork-overlay-scroll="" className="isolate min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div aria-hidden data-fork-card="main" data-testid="bot-page-card" className={BOT_PAGE_CARD} />
          <div className={BOT_PAGE_COLUMN}>
            {toolbar}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The quiet line a page or group shows when it has nothing: "No todos", "No files match". */
export function BotPageEmpty({ children, testId }: { children: ReactNode; testId?: string }) {
  return <p data-testid={testId} className="px-2 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
