import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { inMainWindow } from "../../links/open";
import { rememberConversation } from "../conversations/state";
import { useCall, useLive } from "../live";

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
