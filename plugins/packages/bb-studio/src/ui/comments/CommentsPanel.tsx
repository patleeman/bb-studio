import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import { errorMessage, relativeTime } from "../../kit/format";
import { Button, Icon, ToggleGroup, ToggleGroupItem, cn } from "../../kit/ui/index";
import { dictationParagraphs, spacedAfter, TALK_FIELD_ATTR, TALK_FIELD_LABEL_ATTR, TALK_INSERT_EVENT, toggleTalk, useTalk } from "../../pages/ui/talk";

export interface CommentMessage {
  id: string;
  authorId: string;
  text: string;
  at: number;
}

export interface CommentThread {
  id: string;
  quote: string;
  resolved: boolean;
  resolvedBy?: string | null;
  resolvedAt?: number | null;
  messages: CommentMessage[];
  note?: string | null;
}

export interface CommentDraft {
  quote: string;
  onSubmit(text: string): Promise<void>;
  onCancel(): void;
}

export type CommentAuthorView = ComponentType<{ authorId: string }>;

type Filter = "open" | "resolved";

export function CommentsPanel({
  threads,
  activeId,
  onSelect,
  onResolve,
  onReply,
  draft,
  onClose,
  Author,
  emptyHint,
  dictationLabel,
  actions,
  className,
}: {
  threads: CommentThread[];
  activeId: string | null;
  onSelect(id: string): void;
  onResolve(id: string, resolved: boolean): Promise<void> | void;
  onReply?: (id: string, text: string) => Promise<void>;
  draft?: CommentDraft | null;
  onClose(): void;
  Author: CommentAuthorView;
  emptyHint: string;
  dictationLabel?: string;
  actions?: (thread: CommentThread) => ReactNode;
  className?: string;
}) {
  const open = threads.filter((thread) => !thread.resolved);
  const resolved = threads.filter((thread) => thread.resolved);
  const [filter, setFilter] = useState<Filter>("open");
  const active = activeId ? threads.find((thread) => thread.id === activeId) : undefined;

  useEffect(() => {
    if (active) setFilter(active.resolved ? "resolved" : "open");
  }, [active?.id, active?.resolved]);
  useEffect(() => {
    if (draft) setFilter("open");
  }, [draft]);

  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!activeId) return;
    const card = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-comment-thread]") ?? [])].find((each) => each.dataset.commentThread === activeId);
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId, filter]);

  const shown = filter === "open" ? open : resolved;
  return (
    <aside
      aria-label="Comments"
      data-studio-card=""
      data-testid="comments-panel"
      className={cn("comments-panel flex h-full min-h-0 w-80 shrink-0 flex-col border-l border-border bg-background text-foreground", className)}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <span className="text-sm font-medium">Comments</span>
        <span className="rounded-full bg-state-active px-1.5 text-xs leading-5 tabular-nums text-muted-foreground" aria-label={`${open.length} open`}>{open.length}</span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close comments"
          title="Close comments"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={onClose}
        >
          <Icon name="X" className="size-4" />
        </button>
      </div>
      <div className="shrink-0 px-3 pb-2">
        <ToggleGroup type="single" aria-label="Show comments" value={filter} onValueChange={(value) => { if (value) setFilter(value as Filter); }} className="justify-start gap-1">
          {([["open", "Open", open.length], ["resolved", "Resolved", resolved.length]] as const).map(([value, label, count]) => (
            <ToggleGroupItem
              key={value}
              value={value}
              data-studio-pill=""
              data-testid={`comments-filter-${value}`}
              className="h-7 min-w-0 gap-1.5 px-2.5 text-sm font-normal text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=on]:bg-state-active data-[state=on]:font-medium data-[state=on]:text-foreground"
            >
              {label}
              <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-3">
        {draft && filter === "open" ? <DraftCard draft={draft} dictationLabel={dictationLabel} /> : null}
        {shown.length === 0 && !(draft && filter === "open") ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center" data-testid="comments-empty">
            <Icon name="MessageSquare" className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">{filter === "open" ? (threads.length ? "No open comments" : "No comments yet") : "No resolved comments"}</p>
            {filter === "open" ? <p className="text-xs text-muted-foreground">{emptyHint}</p> : null}
          </div>
        ) : null}
        {shown.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            active={thread.id === activeId}
            onSelect={() => onSelect(thread.id)}
            onResolve={onResolve}
            onReply={onReply}
            Author={Author}
            dictationLabel={dictationLabel}
            actions={actions?.(thread)}
          />
        ))}
      </div>
    </aside>
  );
}

function Quote({ text }: { text: string }) {
  if (!text) return null;
  return (
    <blockquote data-comment-quote="" className="line-clamp-3 border-l-2 border-[color-mix(in_oklch,#eab308_75%,transparent)] pl-2 text-xs leading-5 text-muted-foreground">
      {text}
    </blockquote>
  );
}

function ThreadCard({ thread, active, onSelect, onResolve, onReply, Author, dictationLabel, actions }: {
  thread: CommentThread;
  active: boolean;
  onSelect(): void;
  onResolve(id: string, resolved: boolean): Promise<void> | void;
  onReply?: (id: string, text: string) => Promise<void>;
  Author: CommentAuthorView;
  dictationLabel?: string;
  actions?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try { await onResolve(thread.id, !thread.resolved); }
    catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return (
    <section
      data-studio-card=""
      data-studio-card-tone={active ? "active" : undefined}
      data-comment-thread={thread.id}
      data-active={active ? "true" : undefined}
      aria-label={thread.quote ? `Comment on “${thread.quote}”` : "Comment"}
      onClick={(event) => { if (!(event.target as HTMLElement).closest("button, textarea, a")) onSelect(); }}
      className={cn(
        "flex cursor-pointer flex-col gap-2.5 rounded-lg border border-border bg-card p-3 text-sm transition-colors",
        active ? "outline-1 -outline-offset-1 outline-solid outline-[color-mix(in_oklch,#eab308_75%,transparent)]" : "hover:bg-state-hover",
        thread.resolved && "opacity-90",
      )}
    >
      <Quote text={thread.quote} />
      {thread.messages.map((message) => (
        <div key={message.id} className="flex flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <Author authorId={message.authorId} />
            <span className="shrink-0 text-xs text-muted-foreground" title={new Date(message.at).toLocaleString()}>{relativeTime(message.at)}</span>
          </div>
          <p className="pl-7 leading-5 whitespace-pre-wrap break-words">{message.text}</p>
        </div>
      ))}
      {thread.note ? <p className="pl-7 text-xs text-muted-foreground">{thread.note}</p> : null}
      {thread.resolved ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="comment-resolved-line">
          <Icon name="CircleCheck" className="size-3.5" />
          <span>Resolved{thread.resolvedBy ? <> by <ResolvedBy Author={Author} authorId={thread.resolvedBy} /></> : null}{thread.resolvedAt ? ` · ${relativeTime(thread.resolvedAt)}` : ""}</span>
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {!thread.resolved && onReply ? <ReplyBox threadId={thread.id} onReply={onReply} dictationLabel={dictationLabel} /> : null}
        <div className="flex items-center gap-1">
          {actions}
          <span className="flex-1" />
          <Button type="button" variant="ghost" size="sm" disabled={busy} className="h-7 gap-1.5 px-2 text-xs" data-testid={thread.resolved ? "comment-reopen" : "comment-resolve"} onClick={() => void toggle()}>
            <Icon name={thread.resolved ? "RotateCcw" : "Check"} className="size-3.5" />
            {thread.resolved ? "Reopen" : "Resolve"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function ResolvedBy({ Author, authorId }: { Author: CommentAuthorView; authorId: string }) {
  return <span data-resolved-by="" className="inline-flex align-baseline [&_[data-author-avatar]]:hidden [&_[data-author-name]]:text-xs [&_[data-author-name]]:font-normal"><Author authorId={authorId} /></span>;
}

function ReplyBox({ threadId, onReply, dictationLabel }: { threadId: string; onReply(id: string, text: string): Promise<void>; dictationLabel?: string }) {
  return (
    <CommentField
      fieldKey={`comment-reply:${threadId}`}
      placeholder="Reply…"
      submitLabel="Reply"
      dictationLabel={dictationLabel}
      onSubmit={(text) => onReply(threadId, text)}
    />
  );
}

function DraftCard({ draft, dictationLabel }: { draft: CommentDraft; dictationLabel?: string }) {
  return (
    <section data-studio-card="" data-studio-card-tone="active" data-testid="comment-draft" aria-label="New comment" className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 text-sm outline-1 -outline-offset-1 outline-solid outline-[color-mix(in_oklch,#eab308_75%,transparent)]">
      <Quote text={draft.quote} />
      <CommentField fieldKey="comment-draft" placeholder="Add a comment…" submitLabel="Comment" autoFocus dictationLabel={dictationLabel} onSubmit={draft.onSubmit} onCancel={draft.onCancel} />
    </section>
  );
}

function CommentField({ fieldKey, placeholder, submitLabel, autoFocus, dictationLabel, onSubmit, onCancel }: {
  fieldKey: string;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  dictationLabel?: string;
  onSubmit(text: string): Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const talk = useTalk(fieldKey);
  const recording = talk.mode === "here";
  const working = recording && ["starting", "finalizing", "transcribing"].includes(talk.phase);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    input.style.overflowY = input.scrollHeight > 160 ? "auto" : "hidden";
  }, [text]);
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const onInsert = (event: Event) => {
      const transcript = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      const paragraphs = typeof transcript === "string" ? dictationParagraphs(transcript) : [];
      if (!paragraphs.length) return;
      event.preventDefault();
      event.stopPropagation();
      setText((current) => (current.trim() ? spacedAfter(current, paragraphs.join("\n")) : paragraphs.join("\n")));
    };
    field.addEventListener(TALK_INSERT_EVENT, onInsert);
    return () => field.removeEventListener(TALK_INSERT_EVENT, onInsert);
  }, []);

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setText("");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const label = recording ? (working ? "Transcribing comment" : "Stop dictating comment") : "Dictate comment";
  return (
    <div ref={fieldRef} className="flex flex-col gap-2" {...(dictationLabel ? { [TALK_FIELD_ATTR]: fieldKey, [TALK_FIELD_LABEL_ATTR]: dictationLabel } : {})}>
      <div className="relative">
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder.replace("…", "")}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
            else if (event.key === "Escape" && onCancel) { event.preventDefault(); onCancel(); }
          }}
          className="block w-full resize-none overflow-hidden rounded-md border border-input bg-transparent py-1.5 pr-9 pl-2.5 text-sm leading-5 placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        />
        {dictationLabel && talk.mode !== "unavailable" ? (
          <button
            type="button"
            aria-label={label}
            aria-pressed={recording}
            title={talk.mode === "elsewhere" ? "Talk is busy with another recording." : label}
            disabled={working || talk.mode === "elsewhere"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleTalk(fieldKey)}
            className="absolute top-1 right-1 flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50"
          >
            <Icon name={recording && !working ? "Square" : "Mic"} className={cn("size-3.5", working ? "animate-pulse" : recording && "text-red-500")} />
          </button>
        ) : null}
      </div>
      {text.trim() || onCancel ? (
        <div className="flex items-center justify-end gap-1">
          {onCancel ? <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancel}>Cancel</Button> : null}
          <Button type="button" size="sm" className="h-7 px-2.5 text-xs" disabled={busy || !text.trim()} onClick={() => void submit()}>{submitLabel}</Button>
        </div>
      ) : null}
    </div>
  );
}
