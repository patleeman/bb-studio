// The Library (6f): "the Bot's files", the root page of Studio's nav panel,
// on the Bot-page template (src/ui/bot-page). Everything the current Bot and
// its workers made, newest first, one line each with its kind, where it came
// from ("made in Launch prep", "by Fable lead") and its age. Grouped by
// conversation (default; the group's title opens it), kind or date; a
// search field, Kind pills and a Group by menu. A group shows 8 rows, then "N more"; near-identical files from one
// source are one row with a count. A file opens as a tab in the workbench
// beside the page; a kind with no workbench view opens at its own address.
// Rules in library-model.ts; data from bot_library.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";
import type { LibraryItem } from "../../bot-threads-contract";
import { NoDragStyle } from "../../kit/ui/no-drag";
import { useCurrentBot } from "../conversations/state";
import { MenuSelect } from "../menu-select";
import { ItemIcon } from "../item-row";
import { shortAge } from "../conversations/model";
import { useLive } from "../live";
import { BotPageEmpty, BotPageGroup, BotPageLayout, BotPageRow, BotPageToolbar, useRowOpen } from "../bot-page";
import { foldRows, kindLabel, LIBRARY_GROUPS, LIBRARY_KINDS, libraryGroups, provenance, type LibraryGroupBy, type LibraryKindFilter } from "./library-model";

const GROUP_KEY = "studio.library.group";

/** The Studio kind whose icon a file shows. */
const iconKind = (item: LibraryItem): string => item.kind === "whiteboard" ? "drawing" : item.kind === "app" ? item.type ?? "mini" : item.kind === "other" ? item.type ?? "page" : item.kind;

function readGroup(): LibraryGroupBy {
  try { const value = localStorage.getItem(GROUP_KEY); return value === "kind" || value === "date" ? value : "conversation"; } catch { return "conversation"; }
}

export function LibraryPage() {
  const navigate = useBbNavigate();
  const rowOpen = useRowOpen();
  const chosen = useCurrentBot();
  const spaces = useLive("bot_spaces", {}, { pollMs: 120_000 });
  const botId = chosen ?? spaces.data?.currentBotId ?? undefined;
  const bot = spaces.data?.bots.find((each) => each.id === botId) ?? spaces.data?.bots[0] ?? null;
  const library = useLive("bot_library", botId ? { botId } : {}, { pollMs: 120_000 });
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<LibraryKindFilter>("all");
  const [groupBy, setGroupBy] = useState<LibraryGroupBy>(readGroup);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => { try { localStorage.setItem(GROUP_KEY, groupBy); } catch { /* private mode */ } }, [groupBy]);
  const items = library.data?.items ?? NO_ITEMS;
  const groups = useMemo(() => libraryGroups(items, { query, kind, groupBy }, now), [items, query, kind, groupBy, now]);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());

  return (
    <BotPageLayout testId="library" title="Library" bot={bot?.name} botId={bot?.id}
      toolbar={<BotPageToolbar<LibraryKindFilter> search={{ value: query, onChange: setQuery, placeholder: "Search files" }}
        filter={{ label: "Kind", value: kind, options: LIBRARY_KINDS, onChange: setKind }}
        menus={<MenuSelect<LibraryGroupBy> testId="library-group" label="Group by" value={groupBy} choices={LIBRARY_GROUPS} onChange={setGroupBy} className="h-8 text-sm" />} />}>
      <NoDragStyle />
      {groups.map((group) => {
        const { shown, more } = foldRows(group.rows, unfolded.has(group.key));
        return (
          <BotPageGroup key={group.key} testId="library-group-section" label={group.title} count={group.items.length}
            title={group.threadId
              ? <button type="button" onClick={() => navigate.toThread(group.threadId!)} className="truncate text-left hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{group.title}</button>
              : group.title}>
            {shown.map(({ key, item, count }) => (
              <BotPageRow key={key} testId="library-row" data={{ "data-count": String(count) }} icon={<ItemIcon kind={iconKind(item)} />}
                title={count > 1 ? <>{item.title} <span data-testid="library-count" aria-label={`${count} like it`} className="text-xs tabular-nums text-muted-foreground">×{count}</span></> : item.title}
                titleText={count > 1 ? `${item.title} (the newest of ${count} like it)` : item.title}
                meta={[groupBy === "kind" ? null : kindLabel(item.kind), groupBy === "conversation" && item.madeIn && item.madeIn.kind !== "worker" ? null : provenance(item), shortAge(item.updatedAt, now)].filter(Boolean).join(" · ")}
                disabled={!item.href} {...(item.href ? rowOpen(item.href, item.title) : {})} />
            ))}
            {more ? (
              <button type="button" data-testid="library-more" onClick={() => setUnfolded((open) => new Set([...open, group.key]))}
                className="flex h-8 items-center rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none">{more} more in {group.title}</button>
            ) : null}
          </BotPageGroup>
        );
      })}
      {library.data && !groups.length ? <BotPageEmpty testId="library-empty">{items.length ? "No files match" : "No files"}</BotPageEmpty> : null}
      {!library.data && library.error ? <p role="alert" className="px-2 py-6 text-sm text-destructive">{library.error}</p> : null}
    </BotPageLayout>
  );
}

const NO_ITEMS: LibraryItem[] = [];
