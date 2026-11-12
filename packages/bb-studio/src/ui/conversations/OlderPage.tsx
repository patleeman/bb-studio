// The Archive (`/plugins/studio/studio/conversations/<botId>`), on the
// Bot-page template (src/ui/bot-page): what the Bot sidebar leaves out
// (conversations not active in 14 days, workers failed more than 7 days or
// done more than 2 days ago) and the finished conversations, each with
// Reopen. One line per thread: its icon and title, then its status and age.
// Search and the pills (Conversations, Workers, Failed) narrow it; a row
// opens its thread as a tab in the workbench beside the page. Read with bot_threads_older, newest first; a failure
// older than 7 days is grey, not red: it is history, not something to act on
// (UX review 3, item 16). The sidebar's row that opened the page stays
// selected while it is open.
import { useState } from "react";
import { Icon } from "../../kit/app/index";
import { Button } from "../../kit/ui/button";
import { errorMessage } from "../../kit/format";
import { BotPageEmpty, BotPageGroup, BotPageLayout, BotPageRow, BotPageToolbar, useRowOpen, type BotPageTone } from "../bot-page";
import { useCall, useLive } from "../live";
import { shortDate } from "./finish";
import { shortAge, staleFailure } from "./model";
export { OLDER_SUBPATH, olderBotFromPath, olderPath } from "./model";

export type ArchiveFilter = "all" | "conversations" | "workers" | "failed";

function OlderGlyph({ status, stale }: { status: string; stale: boolean }) {
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

const matches = (query: string, ...texts: (string | null | undefined)[]) => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = texts.filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
};

export default function OlderPage({ botId }: { botId: string | null }) {
  const rowOpen = useRowOpen();
  const thread = (threadId: string, title: string) => rowOpen({ kind: "conversation", id: threadId }, title);
  const call = useCall();
  const live = useLive("bot_threads_older", botId ? { botId } : {}, { pollMs: 60_000 });
  const spaces = useLive("bot_spaces", {}, { pollMs: 120_000 });
  const bot = spaces.data?.bots?.find((each) => each.id === (botId ?? live.data?.botId)) ?? null;
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ArchiveFilter>("all");
  const now = Date.now();
  const data = live.data;
  const reopen = async (threadId: string) => {
    setError(null);
    try { await call("bot_reopen", { threadId }); live.refresh(); } catch (cause) { setError(errorMessage(cause) || "It didn't reopen."); }
  };
  const showConversations = filter === "all" || filter === "conversations";
  const showWorkers = filter !== "conversations";
  const conversations = showConversations ? [
    ...(data?.conversations ?? []).filter((row) => matches(query, row.title, row.forkedFrom?.title)).map((row) => ({ kind: "older" as const, at: row.updatedAt, row })),
    ...(data?.finished ?? []).filter((row) => matches(query, row.title)).map((row) => ({ kind: "finished" as const, at: row.finishedAt, row })),
  ].sort((a, b) => b.at - a.at) : [];
  const workers = showWorkers ? (data?.workers ?? []).filter((row) => (filter !== "failed" || row.status === "failed") && matches(query, row.title, row.ownerTitle, row.tag)) : [];
  const failed = (data?.workers ?? []).filter((row) => row.status === "failed").length;
  const conversationCount = (data?.conversations.length ?? 0) + (data?.finished.length ?? 0);
  return (
    <BotPageLayout testId="older-page" title="Archive" bot={bot?.name} botId={bot?.id}
      toolbar={<BotPageToolbar<ArchiveFilter> search={{ value: query, onChange: setQuery, placeholder: "Search the archive" }}
        filter={{ label: "Show", value: filter, onChange: setFilter, options: [
          { id: "all", label: "All" },
          { id: "conversations", label: "Conversations", count: conversationCount },
          { id: "workers", label: "Workers", count: data?.workers.length ?? 0 },
          { id: "failed", label: "Failed", count: failed },
        ] }} />}>
      {error || live.error ? <p role="alert" className="text-sm text-destructive">{error ?? live.error}</p> : null}
      {data && !conversations.length && !workers.length ? <BotPageEmpty testId="older-empty">{query.trim() || filter !== "all" ? "Nothing matches" : "Nothing archived"}</BotPageEmpty> : null}
      {conversations.length ? (
        <BotPageGroup title="Conversations" count={conversations.length}>
          {conversations.map((entry) => entry.kind === "older" ? (
            <BotPageRow key={entry.row.threadId} testId="older-conversation" icon="MessageSquare" title={entry.row.title} titleText={entry.row.title}
              meta={shortAge(entry.row.updatedAt, now)} {...thread(entry.row.threadId, entry.row.title)} />
          ) : (
            <BotPageRow key={entry.row.threadId} testId="older-finished" icon="CircleCheck" iconClassName="text-success" title={entry.row.title} titleText={entry.row.title}
              status={{ label: "Finished" }} meta={shortDate(entry.row.finishedAt, now)} {...thread(entry.row.threadId, entry.row.title)}
              actions={<Button type="button" variant="outline" size="sm" data-testid="older-reopen" className="h-7 px-2.5 text-xs font-normal" onClick={() => void reopen(entry.row.threadId)}>Reopen</Button>} />
          ))}
        </BotPageGroup>
      ) : null}
      {workers.length ? (
        <BotPageGroup title={filter === "failed" ? "Failed workers" : "Workers"} count={workers.length}>
          {workers.map((row) => {
            const stale = staleFailure(row, now);
            const status = WORKER_STATUS[row.status];
            return (
              <BotPageRow key={row.threadId} testId="older-worker" icon={<OlderGlyph status={row.status} stale={stale} />} title={row.title} titleText={row.ownerTitle ? `${row.title} · for ${row.ownerTitle}` : row.title}
                status={status ? { label: status.label, tone: stale ? "neutral" : status.tone } : { label: "Done" }}
                meta={[row.tag, shortAge(row.updatedAt, now)].filter(Boolean).join(" · ")} {...thread(row.threadId, row.title)} />
            );
          })}
        </BotPageGroup>
      ) : null}
    </BotPageLayout>
  );
}
