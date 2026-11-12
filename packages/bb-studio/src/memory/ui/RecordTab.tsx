import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { errorMessage } from "../../kit/format";
import { GHOST_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON } from "../../kit/app/pieces";
import { cn, Icon } from "../../kit/ui/index";
import { NotFoundTab } from "../../links/NotFoundTab";
import { linkFor } from "../../links/router";
import { pagePath } from "../../pages/constants";
import { BotItemDetail, BotItemError, type BotPageFact } from "../../ui/bot-page/BotItemDetail";
import { useStudioOpen } from "../../ui/studio-open";
import type { MemoryRecordView } from "../contract";
import { recordDate } from "../shared";
import { useMemory, useMemoryCall } from "./hooks";
import { replacesLabel, sourceLabel, sourceTarget } from "./model";

const recordId = (params: JsonValue | null): string | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  return typeof params.id === "string" && params.id ? params.id : null;
};

export function RecordTab({ params }: { params: JsonValue | null }) {
  const id = recordId(params);
  const found = useMemory("memory.get", { id: id ?? "-" }, !!id);
  const record = found.data?.record ?? null;
  const overview = useMemory("memory.overview", record ? { botId: record.botId } : {}, !!record);
  if (id && found.error && !found.data) return <BotItemError message={found.error} />;
  if (!id || (found.data && !record)) return <NotFoundTab params={{ kind: "record", id, link: id ? linkFor({ kind: "record", id }) : "bb://record" }} />;
  if (!record) return null;
  return <RecordDetail key={record.id} record={record} topics={overview.data?.topics ?? []} />;
}

export function RecordDetail({ record, topics }: { record: MemoryRecordView; topics: readonly { topic: string; count: number }[] }) {
  const open = useStudioOpen();
  const botId = record.botId;
  const onOpenPage = (pageId: string, title?: string | null) => open({ href: pagePath(pageId), ...(title ? { title } : {}) });
  const call = useMemoryCall();
  const [editing, setEditing] = useState(false);
  const isReplaced = !!record.replacedById;
  const target = sourceTarget(record);
  const label = sourceLabel(record);
  const replaces = replacesLabel(record);
  const archive = async (archived: boolean) => {
    try {
      await call("memory.archive", { botId, id: record.id, archived });
      if (archived) toast.success("Record archived", { action: { label: "Undo", onClick: () => void call("memory.archive", { botId, id: record.id, archived: false }) } });
    } catch (cause) {
      toast.error(`Couldn't ${archived ? "archive" : "restore"} the record: ${errorMessage(cause)}`);
    }
  };
  const facts: BotPageFact[] = [
    { label: "Topic", value: record.topic },
    { label: "Added", value: recordDate(record.createdAt) },
    { label: "Source", value: target ? (
      <button type="button" data-testid="memory-source" className="text-left underline decoration-border underline-offset-2 hover:decoration-foreground"
        onClick={() => "pageId" in target ? onOpenPage(target.pageId, record.source.title) : open({ threadId: target.threadId, title: record.source.title })}>{label}</button>
    ) : label },
    ...(replaces ? [{ label: "Replaces", value: <span className="text-warning" data-testid="memory-replaces">{replaces}</span> }] : []),
    ...(isReplaced && record.replacedAt ? [{ label: "Replaced", value: recordDate(record.replacedAt) }] : []),
    ...(record.archived ? [{ label: "Status", value: "Archived" }] : []),
  ];
  return (
    <BotItemDetail testId="record-detail" title={record.topic} facts={facts} actions={editing ? null : <>
      {!isReplaced ? <button type="button" className={cn(OUTLINE_BUTTON, "h-7 px-2.5")} onClick={() => setEditing(true)}><Icon name="Pencil" />Edit</button> : null}
      <button type="button" className={cn(GHOST_BUTTON, "h-7 px-2.5")} onClick={() => void archive(!record.archived)}><Icon name={record.archived ? "RotateCcw" : "Archive"} />{record.archived ? "Restore" : "Archive"}</button>
    </>}>
      {editing ? (
        <RecordEditor botId={botId} initial={{ topic: record.topic, text: record.text }} topics={topics} saveLabel="Save as new record"
          onSave={async ({ topic, text }) => { await call("memory.update", { botId, id: record.id, text, ...(topic !== record.topic ? { topic } : {}) }); }}
          onClose={() => setEditing(false)} />
      ) : <p data-testid="memory-record-text" className="text-sm whitespace-pre-wrap">{record.text}</p>}
    </BotItemDetail>
  );
}

export function RecordEditor({ botId, initial, topics, saveLabel, autoFocusTopic, onSave, onClose }: {
  botId: string;
  initial: { topic: string; text: string };
  topics: readonly { topic: string; count: number }[];
  saveLabel: string;
  autoFocusTopic?: boolean;
  onSave(values: { topic: string; text: string }): Promise<void>;
  onClose(): void;
}) {
  const [topic, setTopic] = useState(initial.topic);
  const [text, setText] = useState(initial.text);
  const [saving, setSaving] = useState(false);
  const ready = topic.trim() && text.trim() && (topic.trim() !== initial.topic || text.trim() !== initial.text.trim());
  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      await onSave({ topic: topic.trim(), text: text.trim() });
      onClose();
    } catch (cause) {
      toast.error(`Couldn't save the record: ${errorMessage(cause)}`);
      setSaving(false);
    }
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); }
  };
  const list = `memory-topics-${botId}`;
  return (
    <div className="flex flex-col gap-2 pt-1" onKeyDown={keys}>
      <input aria-label="Topic" value={topic} list={list} placeholder="Topic" autoFocus={autoFocusTopic} maxLength={60}
        className="h-8 w-48 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onChange={(event) => setTopic(event.target.value)} />
      <datalist id={list}>{topics.map((each) => <option key={each.topic} value={each.topic} />)}</datalist>
      <textarea aria-label="Record" value={text} rows={3} autoFocus={!autoFocusTopic} maxLength={4000} placeholder="A fact, decision or note"
        className="min-h-16 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onChange={(event) => setText(event.target.value)} />
      <div className="flex items-center gap-2">
        <button type="button" className={cn(PRIMARY_BUTTON, "h-7")} disabled={!ready || saving} onClick={() => void save()}>{saving ? "Saving…" : saveLabel}</button>
        <button type="button" className={cn(GHOST_BUTTON, "h-7")} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
