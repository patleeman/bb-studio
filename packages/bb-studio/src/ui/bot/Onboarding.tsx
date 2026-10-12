// The Bot page before a Bot exists: it greets the user as the Bot would, with
// a few starter chips and a composer whose first message makes the Bot. Once
// it exists, its chat is BB's own thread view (ThreadChat), not this.
import { Icon } from "@bb-studio/kit/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TALK_FIELD_ATTR, TALK_FIELD_LABEL_ATTR, TALK_INSERT_EVENT, toggleTalk, useTalk } from "../../pages/ui/talk";
import { BotAvatar } from "./BotAvatar";

const TALK_FIELD = "studio-bot-onboarding";

export interface BotIdentity { name: string; avatar: string; shape: string | null; color: string | null }

export type Starter = { kind: "send"; text: string } | { kind: "preset"; preset: "morning" } | { kind: "customize" };
export const STARTERS: { label: string; starter: Starter }[] = [
  { label: "Plan my week", starter: { kind: "send", text: "Help me plan my week." } },
  { label: "What needs me today?", starter: { kind: "send", text: "What needs me today?" } },
  { label: "Set up a morning brief", starter: { kind: "preset", preset: "morning" } },
  { label: "Customize me", starter: { kind: "customize" } },
];

/** The Bot's hello and a few ways to start. */
export function Greeting({ bot, onStarter, lines }: { bot: BotIdentity; onStarter(starter: Starter): void; lines: string[] }) {
  return (
    <div className="bb-bot-in mt-1 grid grid-cols-[28px_minmax(0,1fr)] gap-x-3">
      <BotAvatar shape={bot.shape} color={bot.color} emoji={bot.avatar} size={28} />
      <div className="min-w-0">
        <div className="mb-0.5 text-xs font-medium text-muted-foreground">{bot.name}</div>
        {lines.map((line) => <p key={line} className="mb-1.5 text-[15px] leading-relaxed">{line}</p>)}
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Suggestions">
          {STARTERS.map(({ label, starter }) => (
            <button key={label} type="button" onClick={() => onStarter(starter)}
              className="inline-flex h-8 items-center rounded-full border border-border bg-background px-3.5 text-[13px] hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The first-message composer: grows with the text; the mic dictates through Talk. */
export function Composer({ name, onSend }: { name: string; onSend(text: string): Promise<boolean> }) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const talk = useTalk(TALK_FIELD);
  const dictating = talk.mode === "here";

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // Talk hands its transcript to the focused dictation field.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const onInsert = (event: Event) => {
      const said = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof said !== "string" || !said.trim()) return;
      event.preventDefault();
      event.stopPropagation();
      setText((before) => (before && !/\s$/.test(before) ? `${before} ${said.trim()}` : `${before}${said.trim()}`));
      el.focus();
    };
    el.addEventListener(TALK_INSERT_EVENT, onInsert);
    return () => el.removeEventListener(TALK_INSERT_EVENT, onInsert);
  }, []);

  const submit = async () => {
    if (!text.trim()) return;
    const sent = text;
    setText("");
    if (!(await onSend(sent))) setText(sent);
  };

  const round = "flex size-8 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  return (
    <div className="rounded-[26px] border border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_-6px_rgba(0,0,0,0.08)] dark:bg-foreground/[0.03]">
      <div className="flex items-end gap-1 p-1.5 pl-3">
        <textarea ref={field} rows={1} value={text} aria-label={`Message ${name}`} placeholder={`Message ${name}`}
          {...{ [TALK_FIELD_ATTR]: TALK_FIELD, [TALK_FIELD_LABEL_ATTR]: `the chat with ${name}` }}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
          }}
          className="max-h-[200px] min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[15px] leading-5 outline-none placeholder:text-muted-foreground/70" />
        {talk.mode !== "unavailable" ? (
          <button type="button" className={`${round} ${dictating ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-state-hover hover:text-foreground"}`}
            aria-label={dictating ? "Stop dictating" : "Dictate"} aria-pressed={dictating} disabled={talk.mode === "elsewhere"} onClick={() => toggleTalk(TALK_FIELD)}>
            <Icon name={dictating && talk.phase !== "recording" ? "Loading" : "Mic"} className={`size-4 ${dictating && talk.phase !== "recording" ? "animate-spin" : ""}`} />
          </button>
        ) : null}
        <button type="button" className={`${round} bg-foreground text-background hover:bg-foreground/90 disabled:bg-foreground/15 disabled:text-muted-foreground`} aria-label="Send" title="Send (Enter)" disabled={!text.trim()} onClick={() => void submit()}><Icon name="ArrowUp" className="size-4" /></button>
      </div>
    </div>
  );
}
