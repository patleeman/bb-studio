import { useEffect, useState } from "react";
import { setLinkActionHandler } from "../../links/actions";
import { inMainWindow } from "../../links/open";
import { useLive } from "../live";
import { EditSpace } from "./EditSpace";
import { useMainViewRect } from "./EditSpaceStage";
import { shownBot } from "./BotSidebarPanel";
import { useCurrentBot } from "./state";

export function EditSpaceHost() {
  const [editing, setEditing] = useState(false);
  const spaces = useLive("bot_spaces", {}, { enabled: editing, pollMs: 60_000 });
  const chosen = useCurrentBot();
  const bots = spaces.data?.bots ?? [];
  const bot = shownBot(bots, chosen, spaces.data?.currentBotId ?? null);
  const stage = useMainViewRect(editing && !!bot);
  useEffect(() => (inMainWindow() ? setLinkActionHandler("edit-space", () => { setEditing(true); return true; }) : undefined), []);
  useEffect(() => { if (editing && spaces.data && !bot) setEditing(false); }, [editing, spaces.data, bot]);
  if (!editing || !bot) return null;
  return <EditSpace key={bot.id} bot={bot} bots={bots} stage={stage} onClose={() => setEditing(false)} />;
}
