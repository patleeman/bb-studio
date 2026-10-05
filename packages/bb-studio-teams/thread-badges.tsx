import { useEffect, useRef, useState } from "react";
import { experimental_usePluginId, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { publishThreadBadges, useSidebarHosted, type ThreadBadge } from "@bb-studio/kit/app";
import type { rpcContract } from "./contract";
import { affects } from "./realtime";

/** Rows of threads working as a bot show its avatar in the Studio Sidebar. */
export function ThreadBadges() {
  const hosted = useSidebarHosted();
  return hosted ? <PublishThreadBadges /> : null;
}

function PublishThreadBadges() {
  const rpc = useRpc<typeof rpcContract>();
  const pluginId = experimental_usePluginId();
  const [badges, setBadges] = useState<ReadonlyMap<string, ThreadBadge>>(new Map());
  const [revision, setRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([rpc.call("threadBots", {}), rpc.call("profiles", {})]).then(
      ([rows, bots]) => {
        if (!active) return;
        const byId = new Map(bots.map((bot) => [bot.id, bot]));
        const next = new Map<string, ThreadBadge>();
        for (const { threadId, botId } of rows) {
          const bot = byId.get(botId);
          if (bot) next.set(threadId, { glyph: bot.avatar || "🤖", label: `Working as ${bot.name}` });
        }
        setBadges(next);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [rpc, revision]);

  useEffect(() => publishThreadBadges(pluginId, badges), [pluginId, badges]);

  // Bot work announces many changes; refetch at most once a second.
  useRealtime("scoped-changed", (event) => {
    if (!affects(event, "bots") || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setRevision((value) => value + 1);
    }, 1000);
  });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return null;
}
