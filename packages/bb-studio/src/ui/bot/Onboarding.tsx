// The Bot page before a Bot exists (and New bot): a centered welcome with one
// question, what the Bot should help with. Create makes the Bot with that as
// its setup (bot_create's `setup`): its first message has it introduce
// itself, ask a couple of questions and then pick its own name, description
// and look with bot_profile_update. Its chat then opens as BB's thread page.
import { Icon } from "../../kit/ui/index";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TALK_FIELD_ATTR, TALK_FIELD_LABEL_ATTR, TALK_INSERT_EVENT, toggleTalk, useTalk } from "../../pages/ui/talk";
import { BOT_STYLES, BotAvatar } from "./BotAvatar";

const TALK_FIELD = "studio-bot-onboarding";

/** Ideas that fill the field; the user can edit them before Create. */
export const IDEAS: { label: string; text: string }[] = [
  { label: "Watch my projects", text: "Keep an eye on my projects and tell me what needs me." },
  { label: "Morning brief", text: "Give me a short brief every weekday morning: what changed, what's stuck, what needs me." },
  { label: "Plan my week", text: "Help me plan my week and keep me on track." },
  { label: "Triage threads", text: "Watch my threads, nudge the stuck ones and tell me which need an answer." },
];

export interface WelcomeLook { shape: string | null; color: string | null; emoji: string }

/** The first-time flow's page: avatar, a title, one question and Create. `onCreate` resolves false when it failed. */
export function Welcome({ first, look, busy, error, onCreate }: { first: boolean; look: WelcomeLook; busy: boolean; error: string | null; onCreate(goal: string): Promise<boolean> }) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const talk = useTalk(TALK_FIELD);
  const dictating = talk.mode === "here";

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 72), 220)}px`;
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
    if (busy) return;
    await onCreate(text.trim());
  };
  const pick = (idea: string) => {
    setText(idea);
    requestAnimationFrame(() => { const el = field.current; if (el) { el.focus(); el.setSelectionRange(idea.length, idea.length); } });
  };

  return (
    <div className="studio-root flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground" data-testid="bot-welcome">
      <style>{BOT_STYLES}</style>
      <div className="m-auto w-full max-w-[36rem] px-6 py-12">
        <div className="bb-bot-in flex flex-col items-center text-center">
          <span className="relative flex size-[88px] items-center justify-center">
            <span className="absolute inset-0 rounded-full opacity-[0.14] blur-xl" style={{ background: look.color ?? undefined }} aria-hidden />
            <BotAvatar shape={look.shape} color={look.color} emoji={look.emoji} size={64} working={busy} />
          </span>
          <h1 className="mt-4 text-[26px] font-semibold tracking-tight">{first ? "Meet your Bot" : "Make another Bot"}</h1>
          <p className="mt-2 max-w-[28rem] text-[15px] leading-relaxed text-balance text-muted-foreground">
            {first
              ? "An always-on agent with its own chat. It sees every project, checks in on a schedule and tells you what needs you."
              : "Each Bot has its own chat, memory, skills and check-ins, and sees every project."}
          </p>
        </div>

        <form className="bb-bot-in mt-9" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label htmlFor="bot-welcome-goal" className="mb-2 block px-1 text-sm font-medium">What should your Bot help with?</label>
          <div className="rounded-2xl border border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] focus-within:border-foreground/25 dark:bg-foreground/[0.03]">
            <textarea id="bot-welcome-goal" ref={field} rows={3} value={text} disabled={busy}
              placeholder="e.g. Keep an eye on my projects and tell me each morning what needs me."
              {...{ [TALK_FIELD_ATTR]: TALK_FIELD, [TALK_FIELD_LABEL_ATTR]: "what your Bot should help with" }}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
              }}
              className="block max-h-[220px] min-h-[72px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/60 disabled:opacity-60" />
            <div className="flex items-center gap-1 px-2.5 pb-2.5">
              {talk.mode !== "unavailable" ? (
                <button type="button" className={`flex size-8 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${dictating ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-state-hover hover:text-foreground"}`}
                  aria-label={dictating ? "Stop dictating" : "Dictate"} aria-pressed={dictating} disabled={talk.mode === "elsewhere" || busy} onClick={() => toggleTalk(TALK_FIELD)}>
                  <Icon name={dictating && talk.phase !== "recording" ? "Loading" : "Mic"} className={`size-4 ${dictating && talk.phase !== "recording" ? "animate-spin" : ""}`} />
                </button>
              ) : null}
              <span className="flex-1" />
              <button type="submit" disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground pr-3 pl-3.5 text-sm font-medium text-background hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:opacity-60">
                {busy ? "Creating…" : "Create Bot"}
                <Icon name={busy ? "Loading" : "ArrowRight"} className={`size-4 ${busy ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          {error ? <p role="alert" className="mt-2 px-1 text-xs text-destructive">{error}</p> : null}
          <div className="mt-4 flex flex-wrap justify-center gap-1.5" aria-label="Ideas">
            {IDEAS.map((idea) => (
              <button key={idea.label} type="button" disabled={busy} onClick={() => pick(idea.text)} aria-pressed={text === idea.text}
                className="inline-flex h-8 items-center rounded-full border border-border px-3.5 text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-foreground/30 aria-pressed:bg-state-active aria-pressed:text-foreground disabled:opacity-50">
                {idea.label}
              </button>
            ))}
          </div>
        </form>

        <p className="mt-10 text-center text-xs leading-relaxed text-muted-foreground">
          It introduces itself, asks a couple of questions, then picks its own name and look.<br />You can change anything later in its Info.
        </p>
      </div>
    </div>
  );
}
