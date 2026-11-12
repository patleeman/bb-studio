// Main tabs kept each Bot's chat as a fixed tab first in every workbench.
// With main tabs gone, a Bot is in the sidebar and its conversations are the
// main view, so Studio closes the fixed tabs it opened before: BB keeps a
// fixed tab until its plugin closes it (`experimental_closeFixedTab`). It
// also keeps the Bots' order for the avatar on a Bot's workbench tab
// (bot-tab-icon.ts). An app overlay that draws nothing.
import * as sdkApp from "@get-bb/plugin-sdk/app";
import { useBbNavigate, type JsonValue } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { member } from "../../kit/app/host-sdk";
import { STUDIO_PLUGIN_ID } from "../../kit/contract";
import { useLive } from "../live";
import { setBotOrder } from "./bot-tab-icon";

export interface FixedTab { pluginId: string; tabId: string; title: string; params: JsonValue | null }

const fixedTabs = member(sdkApp, "experimental_useFixedTabs") ?? member(sdkApp, "experimental_useGlobalTabs");
const useHostFixedTabs = typeof fixedTabs === "function" ? (fixedTabs as () => readonly FixedTab[]) : null;

type CloseFixedTab = (options: { tab: { id: string }; params?: JsonValue }) => boolean;
function closeFixedTabOf(navigate: object): CloseFixedTab | null {
  const method = member(navigate, "experimental_closeFixedTab");
  return typeof method === "function" ? (options) => Boolean((method as CloseFixedTab).call(navigate, options)) : null;
}

/** Studio's fixed tabs, every one of which goes. Pure. */
export function fixedTabsToClose(fixed: readonly FixedTab[], pluginId: string = STUDIO_PLUGIN_ID): { tabId: string; params: JsonValue | null }[] {
  return fixed.filter((tab) => tab.pluginId === pluginId).map((tab) => ({ tabId: tab.tabId, params: tab.params }));
}

function Retire({ fixed }: { fixed: readonly FixedTab[] }) {
  const navigate = useBbNavigate();
  useEffect(() => {
    const close = closeFixedTabOf(navigate);
    if (!close) return;
    for (const each of fixedTabsToClose(fixed)) { try { close({ tab: { id: each.tabId }, ...(each.params === null ? {} : { params: each.params }) }); } catch { /* never fatal */ } }
  }, [fixed, navigate]);
  return null;
}

function RetireWithHost({ useFixed }: { useFixed: () => readonly FixedTab[] }) {
  return <Retire fixed={useFixed()} />;
}

export function RetireFixedBotTabs() {
  const bots = useLive("bot_list", {}, { pollMs: 120_000 }).data?.bots;
  useEffect(() => { if (bots) setBotOrder(bots.map((bot) => bot.id)); }, [bots]);
  return useHostFixedTabs ? <RetireWithHost useFixed={useHostFixedTabs} /> : null;
}
