// The Conversations page (`/plugins/studio/studio/conversations/<botId>`),
// on the Bot-page template (src/ui/bot-page): every conversation of the Bot,
// active ones first (Main, then by last activity), then the archived ones by
// last activity, and its workers. Its row in the sidebar's top group stays
// selected while it is open.
//
// A conversation's row: its title and age, then its summary's first line or
// two (what finishing it wrote, or the record it saved), else why it needs
// the user, else its latest reply. An archived one has Reopen. Pills (All,
// Active, Archived, Workers, Failed) narrow it. Search matches titles at
// once, and after a pause the server's search (bot_conversations_search)
// adds the conversations whose summary or messages have every word, each
// with the matching line in place of its summary. A failure older than 7
// days is grey, not red: it is history (UX review 3, item 16). A row opens
// its thread as a tab in the workbench beside the page.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../../kit/app/index";
import { Button } from "../../kit/ui/button";
import { errorMessage } from "../../kit/format";
import type { ConversationSearchHit, PageConversationRow, WorkerRow } from "../../bot-threads-contract";
import { BotPageEmpty, BotPageGroup, BotPageLayout, BotPageRow, BotPageToolbar, noMatch, useBotPageQuery, useRowOpen, type BotPageTone } from "../bot-page";
import { useCall, useLive } from "../live";
import { shortDate } from "./finish";
import { shortAge, staleFailure } from "./model";
export { OLDER_SUBPATH, olderBotFromPath, olderPath } from "./model";

export type ConversationsFilter = "all" | "active" | "archived" | "workers" | "failed";

/** How long typing pauses before the server's search runs. */
export const SEARCH_DEBOUNCE_MS = 250;

function WorkerGlyph({ status, stale }: { status: string; stale: boolean }) {
  if (status === "running") return <span role="img" aria-label="Running" className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-success border-r-transparent" />;
  if (status === "needs-you") return <span role="img" aria-label="Waiting on you" className="mx-[3px] size-1.5 shrink-0 rounded-full bg-warning" />;
  if (status === "failed") return <Icon name="X" data-stale={stale ? "" : undefined} aria-label={stale ? "Failed, a while ago" : "Failed"} className={`size-3.5 shrink-0 ${stale ? "text-muted-foreground" : "text-destructive"}`} />;
  return <Icon name="Check" aria-label="Done" className="size-3.5 shrink-0 text-success" />;
}

const WORKER_STATUS: Record<string, { label: string; tone: BotPageTone }> = {
  running: { label: "Running", tone: "success" },
  "needs-you": { label: "Waiting on you", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
};

const PLURAL: Record<ConversationsFilter, string> = { all: "conversations or workers", active: "active conversations", archived: "archived conversations", workers: "workers", failed: "failed conversations or workers" };

/** The words of a search, lower case. */
export const searchWords = (query: string) => query.trim().toLowerCase().split(/\s+/).filter(Boolean);

const matches = (words: readonly string[], ...texts: (string | null | undefined)[]) => {
  const text = texts.filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
};

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The text with each search word in it set off. */
export function Highlighted({ text, words }: { text: string; words: readonly string[] }) {
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(pattern);
  return <>{parts.map((part, at) => at % 2 === 1 ? <mark key={at} className="rounded-sm bg-warning/20 px-px text-foreground">{part}</mark> : part)}</>;
}

/** A conversation's second line: the search's snippet, else why it needs the user, else its summary, else its latest reply. */
export function conversationDetail(row: PageConversationRow, hit: ConversationSearchHit | undefined): { text: string | null; tone: BotPageTone; snippet: boolean } {
  if (hit?.snippet) return { text: hit.snippet, tone: "neutral", snippet: true };
  if (row.needsYou && row.archivedAt === null) return { text: row.needsYou.reason, tone: "warning", snippet: false };
  return { text: row.summary ?? row.latest, tone: "neutral", snippet: false };
}

export default function OlderPage({ botId }: { botId: string | null }) {
  const rowOpen = useRowOpen();
  const thread = (threadId: string, title: string) => rowOpen({ kind: "conversation", id: threadId }, title);
  const call = useCall();
  const live = useLive("bot_conversations_all", botId ? { botId } : {}, { pollMs: 60_000 });
  const spaces = useLive("bot_spaces", {}, { pollMs: 120_000 });
  const bot = spaces.data?.bots?.find((each) => each.id === (botId ?? live.data?.botId)) ?? null;
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useBotPageQuery();
  const [filter, setFilter] = useState<ConversationsFilter>("all");
  const settled = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const search = useLive("bot_conversations_search", { ...(botId ? { botId } : {}), query: settled }, { enabled: settled.length > 0, pollMs: 15_000 });
  const now = Date.now();
  const data = live.data;
  const reopen = async (threadId: string) => {
    setError(null);
    try { await call("bot_reopen", { threadId }); live.refresh(); } catch (cause) { setError(errorMessage(cause) || "It didn't reopen."); }
  };
  const words = searchWords(query);
  const searching = words.length > 0;
  const hits = useMemo(() => new Map((settled && search.data?.hits ? search.data.hits : []).map((hit) => [hit.threadId, hit])), [settled, search.data]);
  const all = data?.conversations ?? [];
  const workersAll = data?.workers ?? [];
  const found = (row: { threadId: string }, ...texts: (string | null | undefined)[]) => !searching || hits.has(row.threadId) || matches(words, ...texts);
  const conversationShown = (row: PageConversationRow) => found(row, row.title, row.forkedFrom?.title);
  const workerShown = (row: WorkerRow) => found(row, row.title, row.ownerTitle, row.tag);
  const active = filter === "all" || filter === "active" || filter === "failed" ? all.filter((row) => row.archivedAt === null && (filter !== "failed" || row.failed) && conversationShown(row)) : [];
  const archived = filter === "all" || filter === "archived" || filter === "failed" ? all.filter((row) => row.archivedAt !== null && (filter !== "failed" || row.failed) && conversationShown(row)) : [];
  const workers = filter === "all" || filter === "workers" || filter === "failed" ? workersAll.filter((row) => (filter !== "failed" || row.status === "failed") && workerShown(row)) : [];
  const counts = {
    active: all.filter((row) => row.archivedAt === null).length,
    archived: all.filter((row) => row.archivedAt !== null).length,
    failed: all.filter((row) => row.failed).length + workersAll.filter((row) => row.status === "failed").length,
  };
  const conversationRow = (row: PageConversationRow): ReactNode => {
    const detail = conversationDetail(row, hits.get(row.threadId));
    const isArchived = row.archivedAt !== null;
    const status = row.failed ? { label: "Failed", tone: "danger" as const } : !isArchived && row.running ? { label: "Working", tone: "success" as const } : null;
    const icon = row.failed ? <WorkerGlyph status="failed" stale={false} /> : isArchived ? (row.summary ? "CircleCheck" : "Archive") : "MessageSquare";
    return (
      <BotPageRow key={row.threadId} testId={isArchived ? "conversations-archived" : "conversations-active"} data={{ "data-thread-id": row.threadId, "data-snippet": detail.snippet ? "" : undefined }}
        icon={icon} iconClassName={isArchived && !row.failed && row.summary ? "text-success" : undefined} title={<Highlighted text={row.title} words={words} />} titleText={row.title}
        detail={detail.text ? (detail.snippet ? <Highlighted text={detail.text} words={words} /> : detail.text) : null} detailTone={detail.tone}
        status={status} meta={isArchived ? shortDate(row.updatedAt, now) : shortAge(row.updatedAt, now)} {...thread(row.threadId, row.title)}
        actions={isArchived ? <Button type="button" variant="outline" size="sm" data-testid="conversations-reopen" className="h-7 px-2.5 text-xs font-normal" onClick={() => void reopen(row.threadId)}>Reopen</Button> : null} />
    );
  };
  const nothing = data && !active.length && !archived.length && !workers.length;
  return (
    <BotPageLayout testId="conversations-page" title="Conversations" bot={bot?.name} botId={bot?.id}
      toolbar={<BotPageToolbar<ConversationsFilter> search={{ value: query, onChange: setQuery, placeholder: "Search conversations" }}
        filter={{ label: "Show", value: filter, onChange: setFilter, options: [
          { id: "all", label: "All" },
          { id: "active", label: "Active", count: counts.active },
          { id: "archived", label: "Archived", count: counts.archived },
          { id: "workers", label: "Workers", count: workersAll.length },
          { id: "failed", label: "Failed", count: counts.failed },
        ] }} />}>
      {error || live.error ? <p role="alert" className="text-sm text-destructive">{error ?? live.error}</p> : null}
      {searching && settled && search.data?.indexing ? <p data-testid="conversations-indexing" className="px-2 text-xs text-muted-foreground">Still reading older messages</p> : null}
      {nothing ? <BotPageEmpty testId="conversations-empty" {...(searching
        ? { title: noMatch(PLURAL[filter], query), action: { label: "Clear search", onClick: () => setQuery("") } }
        : filter !== "all" ? { title: `No ${PLURAL[filter]}`, action: { label: "Show all", onClick: () => setFilter("all") } }
        : { title: "No conversations yet" })} /> : null}
      {active.length ? <BotPageGroup title={filter === "failed" ? "Failed conversations" : "Active"} count={active.length}>{active.map(conversationRow)}</BotPageGroup> : null}
      {archived.length ? <BotPageGroup title={filter === "failed" ? "Failed, archived" : "Archived"} count={archived.length}>{archived.map(conversationRow)}</BotPageGroup> : null}
      {workers.length ? (
        <BotPageGroup title={filter === "failed" ? "Failed workers" : "Workers"} count={workers.length}>
          {workers.map((row) => {
            const stale = staleFailure(row, now);
            const status = WORKER_STATUS[row.status];
            const hit = hits.get(row.threadId);
            return (
              <BotPageRow key={row.threadId} testId="conversations-worker" data={{ "data-thread-id": row.threadId, "data-snippet": hit?.snippet ? "" : undefined }} icon={<WorkerGlyph status={row.status} stale={stale} />}
                title={<Highlighted text={row.title} words={words} />} titleText={row.ownerTitle ? `${row.title} · for ${row.ownerTitle}` : row.title}
                detail={hit?.snippet ? <Highlighted text={hit.snippet} words={words} /> : null}
                status={status ? { label: status.label, tone: stale ? "neutral" : status.tone } : { label: "Done" }}
                meta={[row.tag, shortAge(row.updatedAt, now)].filter(Boolean).join(" · ")} {...thread(row.threadId, row.title)} />
            );
          })}
        </BotPageGroup>
      ) : null}
    </BotPageLayout>
  );
}
