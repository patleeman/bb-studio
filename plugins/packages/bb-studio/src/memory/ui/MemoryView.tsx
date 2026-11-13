// The Memory view (`/plugins/studio/studio/memory`), on the Bot-page
// template (src/ui/bot-page): one Bot's memory, shared by every
// conversation. Its core profile page is a folded block above the records,
// edited in place, with its length against the cap. Then its memory records,
// one line each: search ("/" focuses it, Esc clears then leaves it), topic
// pills by frequency, a sort, and New. A record opens as a tab in the
// workbench beside the page (RecordTab.tsx). Replaced records are folded below.
import { lazy, Suspense, useDeferredValue, useEffect, useRef, useState } from "react";
import { cn } from "../../kit/ui/index";
import { isTypingTarget } from "../../ui/typing-target";
import { lastBot } from "../../ui/bot/selection";
import { BotPageEmpty, BotPageGroup, BotPageLayout, BotPageRow, BotPageToolbar, noMatch, useRowOpen } from "../../ui/bot-page";
import type { MemoryRecordView } from "../contract";
import { recordDate, recordLine } from "../shared";
import { useMemory, useMemoryCall, type MemoryResult } from "./hooks";
import { MenuSelect } from "../../ui/menu-select";
import { searchPlaceholder, SORTS, topicPills, type Sort } from "./model";
import { RecordEditor } from "./RecordTab";

const ProfilePane = lazy(() => import("./ProfilePane"));

/** The topic pill for every topic. */
const ALL_TOPICS = "__all__";

/** The view for the Bot the route names, else the Bot last picked in this window, else the primary. */
export default function MemoryView({ botId: routeBot }: { botId: string | null }) {
  const [remembered, setRemembered] = useState(() => routeBot ? null : lastBot() ?? null);
  const botId = routeBot ?? remembered ?? undefined;
  const overview = useMemory("memory.overview", botId ? { botId } : {});
  // A remembered Bot that's gone: show the primary instead.
  useEffect(() => { if (overview.error && !routeBot && remembered) setRemembered(null); }, [overview.error, routeBot, remembered]);
  const data = overview.data;
  if (!data) {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground" data-testid="memory-view">{overview.error ?? "Loading memory…"}</div>;
  }
  return <MemoryPage key={data.bot.id} data={data} />;
}

function MemoryPage({ data }: { data: MemoryResult<"memory.overview"> }) {
  const rowOpen = useRowOpen();
  const botId = data.bot.id;
  const topics = data.topics;
  const count = data.counts.current + data.counts.replaced;
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("newest");
  const [adding, setAdding] = useState(false);
  const search = useDeferredValue(query.trim());
  const list = useMemory("memory.list", { botId, ...(search ? { query: search } : {}), ...(topic ? { topic } : {}), sort, limit: 300 });
  const field = useRef<HTMLInputElement | null>(null);
  // "/" focuses the search from anywhere in the view that isn't a text field.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event)) return;
      const root = field.current?.closest("[data-testid=memory-view]");
      if (root && event.target instanceof Node && event.target !== document.body && !root.contains(event.target)) return;
      event.preventDefault();
      field.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const records = list.data?.records ?? [];
  const current = records.filter((record) => !record.replacedById);
  const replaced = records.filter((record) => record.replacedById);
  const row = (record: MemoryRecordView) => (
    <BotPageRow key={record.id} testId="memory-record" data={{ "data-record-id": record.id }} icon="Brain" title={recordLine(record.text)} titleText={recordLine(record.text)}
      muted={!!record.replacedById || record.archived} status={record.archived ? { label: "Archived" } : null}
      meta={`${record.topic} · ${recordDate(record.createdAt)}`} {...rowOpen({ kind: "record", id: record.id }, record.topic)} />
  );
  return (
    <BotPageLayout testId="memory-view" title="Memory" bot={data.bot.name} botId={botId}
      toolbar={<BotPageToolbar search={{ value: query, onChange: setQuery, placeholder: searchPlaceholder(count), label: "Search records", inputRef: field }}
        filter={{ label: "Topics", value: topic ?? ALL_TOPICS, options: topicPills(topics, topic).map((pill) => ({ id: pill.topic ?? ALL_TOPICS, label: pill.label })), onChange: (value) => setTopic(value === ALL_TOPICS ? null : value) }}
        menus={<MenuSelect<Sort> testId="memory-sort" value={sort} choices={SORTS} onChange={setSort} className="h-8 text-sm" />}
        onNew={() => setAdding(true)} />}>
      {adding ? <AddRecord botId={botId} topic={topic} topics={topics} onDone={() => setAdding(false)} /> : null}
      <BotPageGroup title="Core profile" testId="memory-profile" collapsible defaultOpen={false}
        aside={data.profile ? <span data-testid="memory-profile-count" className={cn("tabular-nums", data.profile.over && "text-warning")}>{data.profile.chars.toLocaleString("en-US")} of {data.profile.cap.toLocaleString("en-US")} characters</span> : null}>
        <article data-testid="memory-profile-page" className="h-[480px] overflow-hidden rounded-md border border-border">
          {data.profile ? (
            <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading…</p>}>
              <ProfilePane key={data.profile.pageId} pageId={data.profile.pageId} header={(page) => (
                <p className="shrink-0 px-6 pt-3 text-xs text-muted-foreground" data-testid="memory-profile-header">Edited {recordDate(page.updatedAt)}</p>
              )} />
            </Suspense>
          ) : <p className="p-6 text-sm text-muted-foreground">No core profile</p>}
        </article>
      </BotPageGroup>
      {list.error && !list.data ? <p role="alert" className="text-sm text-destructive">{list.error}</p> : null}
      {list.data && !records.length ? <BotPageEmpty testId="memory-empty" {...(search
        ? { title: noMatch(topic ? `records in ${topic}` : "records", search), action: { label: "Clear search", onClick: () => setQuery("") } }
        : topic ? { title: `No records in ${topic}`, action: { label: "Show all", onClick: () => setTopic(null) } }
        : { title: "No records yet", hint: "Tell the Bot something to remember, or add a record.", action: adding ? null : { label: "New record", onClick: () => setAdding(true) } })} /> : null}
      {current.length ? <BotPageGroup title="Records" count={current.length} testId="memory-records">{current.map(row)}</BotPageGroup> : null}
      {replaced.length ? <BotPageGroup title="Replaced" count={replaced.length} collapsible defaultOpen={false} testId="memory-replaced">{replaced.map(row)}</BotPageGroup> : null}
      {list.data && list.data.total > records.length ? <p className="px-2 text-xs text-muted-foreground">Showing {records.length} of {list.data.total}</p> : null}
    </BotPageLayout>
  );
}

function AddRecord({ botId, topic, topics, onDone }: { botId: string; topic: string | null; topics: readonly { topic: string; count: number }[]; onDone(): void }) {
  const call = useMemoryCall();
  return (
    <div className="rounded-lg border border-border p-3" data-testid="memory-add">
      <RecordEditor botId={botId} initial={{ topic: topic ?? "", text: "" }} topics={topics} saveLabel="Add record" autoFocusTopic={!topic}
        onSave={async (values) => { await call("memory.add", { botId, ...values }); }} onClose={onDone} />
    </div>
  );
}
