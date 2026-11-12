import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { inMainWindow } from "../../links/open";
import { rememberConversation } from "../conversations/state";
import { useCall, useLive } from "../live";

export interface WelcomeState {
  threadId: string | null;
  opened: boolean;
  pending: boolean;
  bot: { id: string } | null;
}

export function welcomeStep(data: WelcomeState, landed: string | null): { done: boolean; open: string | null } {
  const done = !data.pending;
  if (!data.threadId || !data.bot || data.opened || data.threadId === landed) return { done, open: null };
  return { done, open: data.threadId };
}

export function WelcomeLanding() {
  const call = useCall();
  const navigate = useBbNavigate();
  const [done, setDone] = useState(false);
  const landed = useRef<string | null>(null);
  const live = useLive("bot_welcome", {}, { enabled: !done && inMainWindow(), pollMs: 3_000 });
  const data = live.data;
  useEffect(() => {
    if (done || !data) return;
    const step = welcomeStep(data, landed.current);
    if (step.done) setDone(true);
    if (!step.open || !data.bot) return;
    landed.current = step.open;
    rememberConversation(data.bot.id, step.open);
    void call("bot_welcome_opened", {}).catch(() => {});
    navigate.toThread(step.open);
  }, [data, done, call, navigate]);
  return null;
}
