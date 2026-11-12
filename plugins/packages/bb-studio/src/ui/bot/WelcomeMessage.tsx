import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect, useState, type MouseEvent } from "react";
import { clickModifiers, inMainWindow, useOpenLink } from "../../links/open";
import { BotPresence, type PresenceBot } from "../../presence/ui/BotPresence";
import { WELCOME_MESSAGE, type WelcomePart } from "../../onboarding-message";
import { rememberConversation } from "../conversations/state";
import { useCall, useLive } from "../live";

export interface WelcomeBot extends PresenceBot { name: string }

export function WelcomeMessageView({ bot, onLink }: { bot: WelcomeBot; onLink(link: string, event: MouseEvent): void }) {
  const part = (each: WelcomePart, index: number) => typeof each === "string" ? <span key={index}>{each}</span> : (
    <a key={index} href={each.link} data-link={each.link} className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
      onClick={(event) => { event.preventDefault(); onLink(each.link, event); }}>{each.text}</a>
  );
  return (
    <div data-testid="welcome-message" data-bot={bot.id} className="studio-root mx-auto w-full max-w-3xl shrink-0 px-5 pt-5 pb-3 text-foreground">
      <div className="flex items-center gap-2 text-sm font-medium">
        <BotPresence bot={bot} size={22} still />
        <span>{bot.name}</span>
      </div>
      <div className="mt-2 flex flex-col gap-2 text-[15px] leading-6">
        <p>{WELCOME_MESSAGE.intro}</p>
        <p>{WELCOME_MESSAGE.heading}</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {WELCOME_MESSAGE.tries.map((parts, index) => <li key={index}>{parts.map(part)}</li>)}
        </ul>
      </div>
    </div>
  );
}

export function WelcomeBanner({ threadId }: { threadId: string }) {
  const live = useLive("bot_welcome", {});
  const open = useOpenLink();
  const welcome = live.data;
  if (!welcome?.bot || welcome.threadId !== threadId) return null;
  return <WelcomeMessageView bot={welcome.bot} onLink={(link, event) => { void open(link, { source: "transcript", threadId, modifiers: clickModifiers(event) }); }} />;
}

export function WelcomeLanding() {
  const call = useCall();
  const navigate = useBbNavigate();
  const [done, setDone] = useState(false);
  const live = useLive("bot_welcome", {}, { enabled: !done && inMainWindow(), pollMs: 3_000 });
  const data = live.data;
  useEffect(() => {
    if (done || !data || data.pending) return;
    setDone(true);
    if (!data.threadId || data.opened || !data.bot) return;
    rememberConversation(data.bot.id, data.threadId);
    void call("bot_welcome_opened", {}).catch(() => {});
    navigate.toThread(data.threadId);
  }, [data, done, call, navigate]);
  return null;
}
