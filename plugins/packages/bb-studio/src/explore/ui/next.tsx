// The Next row at the end of a reply (`::next{reply="…" btw="…" do="…"}`):
// quick replies and actions as buttons that draft into the composer, then
// notes about what the agent noticed, with Fix this for 🐛 notes. Each message logs its suggestions
// once as shown, and every click, so `bb studio pages explore stats` can tell which kinds
// earn their place. On a thread you can't write in here (a worker, a thread
// mirrored from bb, a finished conversation) the row isn't drawn: its
// buttons only draft into a composer that isn't there (UX review 3, item 13).
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { Icon } from "../../kit/ui/index";
import { useExploreRpc } from "../client";
import { PLUGIN_ID } from "../constants";
import { BUG_EMOJI, nextItemCount, parseNextItems, type BtwNote, type NextKind } from "../next";
import { labelKey, type ExploreItem } from "../shared";
import { composerFor } from "../../kit/composer";
import { appendDraft } from "./composer";
import { useReadOnly } from "../../ui/conversations/ReadOnlyComposer";

const SETTINGS_HREF = `/settings/plugins/${PLUGIN_ID}`;

const CHIP = "inline-flex h-6 items-center gap-1.5 border border-border bg-transparent px-2 text-xs text-foreground hover:bg-state-hover";
/** Replies are round; things the agent does (Ask for and the notes' buttons) are dashed squares. */
const REPLY_CHIP = `${CHIP} rounded-full`;
const ACTION_CHIP = `${CHIP} rounded-md border-dashed`;

export function NextDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const rpc = useExploreRpc();
  const items = useMemo(() => parseNextItems(attributes), [attributes]);
  const { threadId, id: messageId } = message;
  const shown = useMemo(
    () => [
      ...items.reply.map((item) => ({ kind: "reply" as const, emoji: item.emoji, label: item.label })),
      ...items.do.map((item) => ({ kind: "do" as const, emoji: item.emoji, label: item.label })),
      ...items.btw.filter(isBug).map((note) => ({ kind: "fix" as const, emoji: note.emoji, label: note.label })),
    ],
    [items],
  );
  const shownKey = JSON.stringify(shown);
  const readOnly = useReadOnly(threadId) !== null;

  useEffect(() => {
    if (!shown.length || readOnly) return;
    rpc.call("explore.nextShown", { threadId, messageId, items: shown }).catch(() => undefined);
    // `shownKey` stands for `shown`; the log ignores repeats anyway.
  }, [rpc, threadId, messageId, shownKey, readOnly]);

  if (nextItemCount(items) === 0 || readOnly) return null;

  const logClick = (kind: NextKind, item: ExploreItem) =>
    void rpc.call("explore.nextClicked", { threadId, messageId, kind, emoji: item.emoji, label: item.label }).catch(() => undefined);

  /** Adds `text` to the thread's draft; `item` is what the click log counts. */
  const draft = (kind: NextKind, item: ExploreItem, text: string) => {
    const composer = composerFor(threadId);
    if (!composer) {
      toast.error("Open this thread's composer to use it.");
      return;
    }
    logClick(kind, item);
    composer.replace((current) => ({ text: appendDraft(current.text, text), mentions: current.mentions }));
    composer.focus();
  };

  const chip = (kind: "reply" | "do", item: ExploreItem) => (
    <button
      key={`${kind}:${item.label}`}
      type="button"
      onClick={() => draft(kind, item, `${item.emoji} ${item.label}`)}
      className={kind === "do" ? ACTION_CHIP : REPLY_CHIP}
    >
      <span aria-hidden="true">{item.emoji}</span>
      <span>{item.label}</span>
    </button>
  );

  return (
    <section aria-label="What next?" className="my-3 w-full overflow-hidden rounded-lg border border-border/70 bg-background py-1">
      <header className="flex h-6 items-center gap-1.5 px-3 text-[11px] font-medium text-muted-foreground">
        What next?
        <a
          href={SETTINGS_HREF}
          aria-label="What next settings"
          title="Settings"
          className="ml-auto flex size-5 items-center justify-center rounded text-muted-foreground/50 hover:bg-state-hover hover:text-foreground"
        >
          <Icon name="Settings" fallback="MoreHorizontal" className="size-3.5" />
        </a>
      </header>
      {items.reply.length ? (
        <NextSection label="Reply">
          <div className="flex flex-wrap gap-1.5">{items.reply.map((item) => chip("reply", item))}</div>
        </NextSection>
      ) : null}
      {items.do.length ? (
        <NextSection label="Ask for">
          <div className="flex flex-wrap gap-1.5">{items.do.map((item) => chip("do", item))}</div>
        </NextSection>
      ) : null}
      {items.btw.length ? (
        <NextSection label="By the way">
          <BtwNotes
            notes={items.btw}
            onFix={(note) => draft("fix", note, `${BUG_EMOJI} Fix this: ${note.text}`)}
          />
        </NextSection>
      ) : null}
    </section>
  );
}

/** One kind of next step: a short label in the gutter. */
function NextSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex gap-3 px-3 py-1">
      <span className="w-16 shrink-0 pt-1 text-[11px] leading-4 text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const isBug = (note: BtwNote) => note.emoji === BUG_EMOJI;

/** Notes back to the user, with Fix this for 🐛 notes. */
function BtwNotes({ notes, onFix }: { notes: readonly BtwNote[]; onFix(note: BtwNote): void }) {
  return (
    <ul className="space-y-1.5" aria-label="Things the agent noticed">
      {notes.map((note) => {
        const key = labelKey(note.label);
        return (
          <li key={key} className="flex gap-2 pt-0.5 text-sm">
            <span aria-hidden className="w-4 shrink-0 text-center leading-5">
              {note.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <p className="leading-5 text-foreground">{note.text}</p>
              {isBug(note) ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => onFix(note)} className={ACTION_CHIP}>
                    <span aria-hidden="true">🔧</span>
                    <span>Fix this</span>
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
