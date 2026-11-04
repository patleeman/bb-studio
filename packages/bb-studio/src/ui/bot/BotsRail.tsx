// The rail's Bots item (app.tsx): a nav panel whose badge counts the Bots
// that need the user (critical), or shows a dot while one has a reply they
// haven't read (neutral). Its page is a hop to the Bot page, which opens the
// last Bot thread this window had open (BotHome's useBotLanding), the same
// place the sidebar's Bots section opens.
import type { ExperimentalBadge } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { openAppPath } from "../../kit/app/index";
import { useLive } from "../live";
import { railBadge } from "./rowState";
import { BOT_PATH } from "./selection";

/** The rail item's id and path under /plugins/studio/. */
export const BOTS_PANEL = "bots";

export function useBotsBadge(): ExperimentalBadge | null {
  const live = useLive("bot_attention_all", {}, { pollMs: 30_000 });
  return railBadge(live.data?.bots ?? []);
}

/** The Bots panel: straight on to the Bot page, replacing this address in history. */
export function BotsPanel() {
  useEffect(() => { openAppPath(BOT_PATH, { replace: true }); }, []);
  return null;
}
