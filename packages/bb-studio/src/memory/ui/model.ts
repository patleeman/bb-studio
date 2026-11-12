// What the Memory view shows, as pure functions: a record's source link and
// its "replaces" line, the topic pills, and the sort.
import type { MemoryRecordView } from "../contract";
import { recordDate, snippet } from "../shared";

export const SORTS = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "topic", label: "Topic" },
] as const;
export type Sort = (typeof SORTS)[number]["id"];

/** "from Main", "from “Launch prep” (finished)", "from Runner: staff sweep", "from “Chief of Staff's Memory” › Systems", "added by you". */
export function sourceLabel(record: Pick<MemoryRecordView, "source" | "sourceState">): string {
  const { source } = record;
  if (source.kind === "manual") return source.title.charAt(0).toLowerCase() + source.title.slice(1);
  const quoted = source.kind === "worker" || source.title === "Main" ? source.title : `“${source.title}”`;
  const state = record.sourceState === "finished" ? " (finished)" : record.sourceState === "missing" ? " (removed)" : "";
  return `from ${quoted}${source.section ? ` › ${source.section}` : ""}${state}`;
}

/** What a source link opens: a thread, a page, or nothing (manual, or a thread that's gone). */
export function sourceTarget(record: Pick<MemoryRecordView, "source" | "sourceState">): { threadId: string } | { pageId: string } | null {
  const { source } = record;
  if (!source.id || source.kind === "manual" || record.sourceState === "missing") return null;
  return source.kind === "page" ? { pageId: source.id } : { threadId: source.id };
}

/** The amber line on a record that corrected another: replaces “…” (Nov 6). */
export function replacesLabel(record: Pick<MemoryRecordView, "replaces">, now = Date.now()): string | null {
  return record.replaces ? `replaces “${snippet(record.replaces.text)}” (${recordDate(record.replaces.createdAt, now)})` : null;
}

/** All, then the topics most used first (the server's order), with the picked one kept even when it has no records left. */
export function topicPills(topics: readonly { topic: string; count: number }[], picked: string | null): { topic: string | null; label: string }[] {
  const pills: { topic: string | null; label: string }[] = [{ topic: null, label: "All" }, ...topics.map((each) => ({ topic: each.topic, label: each.topic }))];
  if (picked && !topics.some((each) => each.topic.toLowerCase() === picked.toLowerCase())) pills.push({ topic: picked, label: picked });
  return pills;
}

/** "Search 214 records", "Search 1 record". */
export function searchPlaceholder(count: number): string {
  return `Search ${count.toLocaleString("en-US")} record${count === 1 ? "" : "s"}`;
}
