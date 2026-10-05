// The Next row at the end of a reply (`::next{reply="…" btw="…" do="…"}`):
// quick replies and actions as buttons that draft into the composer, then
// notes about what the agent noticed, each with Tell me more (an explainer)
// and, for 🐛 notes, Fix this. Each message logs its suggestions once
// as shown, and every click, so `bb pages explore stats` can tell which kinds
// earn their place.
import { useComposer, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { cn, Icon } from "@bb-studio/kit/ui";
import { useExploreRpc } from "../../client";
import { PLUGIN_ID } from "../constants";
import { BUG_EMOJI, nextItemCount, parseNextItems, type BtwNote, type NextKind } from "../next";
import { labelKey, type ExploreItem } from "../shared";
import { appendDraft, mountedComposers, pickComposer } from "./composer";
import { rowState } from "./explore";
import { useExplainers, type ExplainerTarget } from "./rows";

const SETTINGS_HREF = `/settings/plugins/${PLUGIN_ID}`;

/** Keeps each mounted composer's API where message directives can reach it. Renders nothing. */
export function ComposerBridge() {
  const composer = useComposer();
  useEffect(() => {
    mountedComposers.push(composer);
    return () => {
      const index = mountedComposers.indexOf(composer);
      if (index !== -1) mountedComposers.splice(index, 1);
    };
  }, [composer]);
  return null;
}

export function NextDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const rpc = useExploreRpc();
  const items = useMemo(() => parseNextItems(attributes), [attributes]);
  const { threadId, id: messageId } = message;
  const shown = useMemo(
    () => [
      ...items.reply.map((item) => ({ kind: "reply" as const, emoji: item.emoji, label: item.label })),
      ...items.do.map((item) => ({ kind: "do" as const, emoji: item.emoji, label: item.label })),
      ...items.btw.map((note) => ({ kind: "explore" as const, emoji: note.emoji, label: note.label })),
      ...items.btw.filter(isBug).map((note) => ({ kind: "fix" as const, emoji: note.emoji, label: note.label })),
    ],
    [items],
  );
  const shownKey = JSON.stringify(shown);

  useEffect(() => {
    if (!shown.length) return;
    rpc.call("nextShown", { threadId, messageId, items: shown }).catch(() => undefined);
    // `shownKey` stands for `shown`; the log ignores repeats anyway.
  }, [rpc, threadId, messageId, shownKey]);

  if (nextItemCount(items) === 0) return null;

  const logClick = (kind: NextKind, item: ExploreItem) =>
    void rpc.call("nextClicked", { threadId, messageId, kind, emoji: item.emoji, label: item.label }).catch(() => undefined);

  /** Adds `text` to the thread's draft; `item` is what the click log counts. */
  const draft = (kind: NextKind, item: ExploreItem, text: string) => {
    const composer = pickComposer(mountedComposers, threadId);
    if (!composer) {
      toast.error("Open this thread's composer to use it, in the main view or Float.");
      return;
    }
    logClick(kind, item);
    composer.updateText((current) => appendDraft(current, text));
    composer.focus();
  };

  const chip = (kind: "reply" | "do", item: ExploreItem) => (
    <button
      key={`${kind}:${item.label}`}
      type="button"
      onClick={() => draft(kind, item, `${item.emoji} ${item.label}`)}
      title={kind === "do" ? "Draft this request in your message box" : "Draft this reply in your message box"}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 border border-border bg-transparent px-2 text-xs text-foreground hover:bg-state-hover",
        kind === "do" ? "rounded-md border-dashed" : "rounded-full",
      )}
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
          title="Settings: turn these suggestions off for new agent sessions."
          className="ml-auto flex size-5 items-center justify-center rounded text-muted-foreground/50 hover:bg-state-hover hover:text-foreground"
        >
          <Icon name="Settings" fallback="MoreHorizontal" className="size-3.5" />
        </a>
      </header>
      {items.reply.length ? (
        <NextSection label="Reply" hint="Answer this message. Clicking one drafts it for you to send.">
          <div className="flex flex-wrap gap-1.5">{items.reply.map((item) => chip("reply", item))}</div>
        </NextSection>
      ) : null}
      {items.do.length ? (
        <NextSection label="Ask for" hint="Things the agent can do next. Clicking one drafts the request for you to send.">
          <div className="flex flex-wrap gap-1.5">{items.do.map((item) => chip("do", item))}</div>
        </NextSection>
      ) : null}
      {items.btw.length ? (
        <NextSection label="By the way" hint="Things the agent noticed outside what you asked about.">
          <BtwNotes
            notes={items.btw}
            threadId={threadId}
            messageId={messageId}
            turnId={message.turnId}
            onExplore={(item) => logClick("explore", item)}
            onFix={(note) => draft("fix", note, `${BUG_EMOJI} Fix this: ${note.text}`)}
          />
        </NextSection>
      ) : null}
    </section>
  );
}

/** One kind of next step: a short label in the gutter, saying what its buttons are for. */
function NextSection({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex gap-3 px-3 py-1">
      <span title={hint} className="w-16 shrink-0 cursor-help pt-1 text-[11px] leading-4 text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const isBug = (note: BtwNote) => note.emoji === BUG_EMOJI;

/** Notes back to the user, each with Tell me more (its explainer's state) and, for 🐛 notes, Fix this. */
function BtwNotes({ notes, onFix, ...target }: ExplainerTarget & { notes: readonly BtwNote[]; onFix(note: BtwNote): void }) {
  const { byLabel, busy, errors, act } = useExplainers(target);
  return (
    <ul className="space-y-1.5" aria-label="Things the agent noticed">
      {notes.map((note) => {
        const key = labelKey(note.label);
        const explainer = byLabel.get(key);
        const error = errors[key] ?? null;
        const state = error ? "error" : rowState(explainer);
        const progress = Math.round(explainer?.job?.progress ?? 0);
        const more =
          state === "running" ? `Writing · ${progress}%` : state === "ready" ? "Open explanation" : state === "error" ? "Retry" : "Tell me more";
        return (
          <li key={key} className="flex gap-2 pt-0.5 text-sm">
            <span aria-hidden className="w-4 shrink-0 text-center leading-5">
              {note.emoji}
            </span>
            <p className="min-w-0 flex-1 leading-5 text-foreground">
              {note.text}{" "}
              <span className="whitespace-nowrap text-xs">
                <button
                  type="button"
                  onClick={() => void act(note, explainer, false, note.text)}
                  disabled={Boolean(busy[key])}
                  title={error ?? explainer?.job?.detail ?? "Write a page explaining this"}
                  className={cn(
                    "font-medium hover:underline disabled:cursor-progress",
                    state === "error" ? "text-destructive" : "text-muted-foreground hover:text-foreground",
                    state === "running" && "animate-pulse motion-reduce:animate-none",
                  )}
                >
                  {more}
                </button>
                {isBug(note) ? (
                  <>
                    <span aria-hidden className="text-muted-foreground/50"> · </span>
                    <button type="button" onClick={() => onFix(note)} title="Draft a request to fix this" className="font-medium text-muted-foreground hover:text-foreground hover:underline">
                      Fix this
                    </button>
                  </>
                ) : null}
              </span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
