import { CommandPage } from "./command-view";
import { affects } from "./realtime";
import { UsagePanel } from "./usage-panel";
import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc, useRealtime, useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { Bot, BotListItem, Conversation, Job } from "./contract";
import type { rpcContract } from "./client-contract";
import { AddOnCollection, BarCrumb, CopyReferenceMenuItem, StudioBarSlot, type ProviderCall } from "@bb-studio/kit/app";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import { Button } from "@bb-studio/kit/ui";
import { TabBar, ProfileForm, DocumentEditor, WorkList, ErrorMessage, message } from "./bot-ui";

import { Modal } from "./controls";
import { ProfilePicker } from "./profile-picker";
import { ThreadBadges } from "./thread-badges";
import { ProfileThreads } from "./profile-threads";
import { BotCreateRequests } from "./bot-create-requests";
import { BotCreationThread } from "./bot-creation-thread";
import { BotChat } from "./bot-chat";
import { BOT_KIND, NEW_BOT_EVENT, PLUGIN_ID, botHref } from "./studio-provider";
import { Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, FloatPanels, retainPanel, ICON_BUTTON, Icon as KitIcon, ItemHeader, ItemTile, ITEM_TITLE, openAppPath, PageColumn, SECTION_TITLE, studioPath, useStudioPresent } from "@bb-studio/kit/app";

import { externalAgent } from "./external-agents";
import { ExternalAgentBadge, useExternalHealth } from "./external-health";
import "./styles.css";
import { botTeamsIcons } from "./icons";

const tabs = ["profile", "mission", "memory", "threads", "activity", "usage"] as const;
const STATUS_TONES = {
  ready: "success",
  working: "live",
  paused: "neutral",
  error: "danger",
} as const;

function BotDetail({ id, tab, href }: { id: string; tab: string; href: string }) {
  const rpc = useRpc<typeof rpcContract>(),
    studio = useStudioPresent();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [data, setData] = useState<{
      bot: Bot;
      conversations: Conversation[];
      jobs: Job[];
    } | null>(null),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const request = useRef(0);
  const load = useCallback(() => {
    const seq = ++request.current;
    rpc.call("get", { id }).then(
      (d) => {
        if (seq === request.current) {
          setData(d);
          setError(null);
        }
      },
      (e) => {
        if (seq === request.current) setError(message(e));
      },
    );
  }, [rpc, id]);
  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);
  useRealtime("scoped-changed", (event) => { if (affects(event, "bots", id)) load(); });
  const externalHealth = useExternalHealth([data?.bot.providerId]);
  const action = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  };
  if (!data)
    return (
      <PageColumn>
        <ErrorMessage error={error} />
        <p role="status" className="text-sm text-muted-foreground">Loading bot…</p>
      </PageColumn>
    );
  const { bot, jobs } = data;
  const activeWork = jobs.some((job) =>
    ["queued", "dispatching", "running"].includes(job.status),
  );
  const botStatus = bot.error
    ? "error"
    : activeWork
      ? "working"
      : bot.retired
        ? "paused"
        : "ready";
  const statusLabel = bot.retired
    ? "Archived"
    : bot.error
      ? "Failing"
      : botStatus === "working"
          ? "Working"
          : "Ready";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ItemHeader
        item={{ href, title: bot.name }}
        chatAction={bot.retired ? null : <BotChat key={id} id={id} disabled={pending} onError={setError} />}
        backLabel={studio ? "Studio" : "Bots"}
        onBack={() =>
          openAppPath(studio ? studioPath("bot") : `/plugins/${PLUGIN_ID}/bots`)
        }
        leading={<>
          <BarCrumb current><span className="truncate">{bot.avatar ? `${bot.avatar} ` : ""}{bot.name}</span></BarCrumb>
          <span className="ml-1 shrink-0"><Badge label={statusLabel} tone={STATUS_TONES[botStatus]} /></span>
        </>}
        trailing={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Bot options" className={ICON_BUTTON}>
                  <KitIcon name="MoreHorizontal" className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <CopyReferenceMenuItem item={{ href: botHref(id), title: bot.name }} />
                <DropdownMenuItem
                  disabled={pending || !!bot.retired}
                  onSelect={() => void action(() => rpc.call("wake", { id }))}
                >
                  <KitIcon name="Zap" className="size-4" /> Wake now
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    bot.retired
                      ? void action(() => rpc.call("retire", { id, retired: false }))
                      : setArchiveOpen(true)
                  }
                >
                  <KitIcon name={bot.retired ? "RotateCcw" : "Archive"} className="size-4" />
                  {bot.retired ? "Restore bot" : "Archive bot"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <PageColumn className="flex min-h-full flex-col">
        <div className="flex items-center gap-4 pb-4">
          <ItemTile icon={bot.avatar || null} kindIcon="Bot" size="xl" />
          <div className="min-w-0">
            <h1 className={`truncate ${ITEM_TITLE}`}>{bot.name}</h1>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              @{bot.handle}
              {bot.description ? ` · ${bot.description}` : ""}
            </p>
            {externalAgent(bot.providerId) && <ExternalAgentBadge className="mt-1.5" providerId={bot.providerId} health={externalHealth[bot.providerId]} />}
          </div>
        </div>
        <TabBar
          items={tabs}
          selected={tab}
          label="Bot sections"
          onSelect={(t) =>
            openAppPath(`${botHref(id)}/${t}`)
          }
        />
        <Modal
          title={`Archive ${bot.name}?`}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
        >
          <p className="text-sm leading-5">
            This stops the bot’s work and stops its mission schedule. Its
            profile, mission, memory, files, and conversation history are
            preserved. You can restore it later.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setArchiveOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() =>
                action(async () => {
                  await rpc.call("retire", { id, retired: true });
                  setArchiveOpen(false);
                })
              }
            >
              Archive bot
            </Button>
          </div>
          <ErrorMessage error={error} />
        </Modal>
        {(error || bot.error) && (
          <div className="mt-4">
            <ErrorMessage error={error || bot.error} />
          </div>
        )}
        <div className="mt-5 flex flex-1 flex-col">
          {tab === "profile" && (
            <ProfileForm
              key={bot.id}
              bot={bot}
              onSaved={load}
              onArchive={() => {
                if (bot.retired) {
                  void action(() => rpc.call("retire", { id, retired: false }));
                } else {
                  setArchiveOpen(true);
                }
              }}
            />
          )}
          {(tab === "mission" || tab === "memory") && (
            <DocumentEditor
              key={`${id}/${tab}`}
              bot={bot}
              file={tab === "mission" ? "MISSION.md" : "MEMORY.md"}
            />
          )}
          {tab === "threads" && <ProfileThreads id={id} />}
          {tab === "usage" && <UsagePanel id={id} />}
          {tab === "activity" && (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className={SECTION_TITLE}>
                  Activity
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || bot.retired}
                  onClick={() => action(() => rpc.call("wake", { id }))}
                >
                  Wake now
                </Button>
              </div>
              <WorkList jobs={jobs} bots={[bot]} />
            </>
          )}
        </div>
      </PageColumn>
    </div>
  );
}
function BotsPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<{
      bots: BotListItem[];
      botCreateRequests: import("./contract").BotCreateRequestView[];
    } | null>(null),
    [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(() => {
    const seq = ++request.current;
    rpc.call("list").then(
      (r) => {
        if (seq === request.current) {
          setData(r);
          setError(null);
        }
      },
      (e) => {
        if (seq === request.current) setError(message(e));
      },
    );
  }, [rpc]);
  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);
  useRealtime("scoped-changed", (event) => { if (affects(event, "bots")) load(); });
  const [id, section] = subPath.split("/");
  if (id === "new")
    return <BotCreationThread />;
  if (id)
    return (
      <BotDetail
          key={id}
          id={id}
          href={`${botHref(id)}${section ? `/${section}` : ""}`}
          tab={
            tabs.includes(section as (typeof tabs)[number])
              ? section
              : "profile"
          }
        />
    );
  return <BotList requests={data?.botCreateRequests ?? null} error={error} onResolved={load} />;
}
/**
 * The bots as a collection, like every add-on's page. It never hands over
 * to Studio, which doesn't list bots.
 */
function BotList({
  requests,
  error,
  onResolved,
}: {
  requests: import("./contract").BotCreateRequestView[] | null;
  error: string | null;
  onResolved: () => void;
}) {
  const rpc = useRpc<StudioSchemas["provider"]>();
  const call = useCallback<ProviderCall>((method, input) => rpc.call(method, input as never) as never, [rpc]);
  const [version, setVersion] = useState(0);
  useRealtime("scoped-changed", (event) => { if (affects(event, "bots")) setVersion((value) => value + 1); });
  if (requests === null && !error) return null;
  return (
    <div className="flex h-full flex-col">
      {requests?.length ? (
        <div className="mx-10 mt-6 max-md:mx-4">
          <BotCreateRequests botCreateRequests={requests} onBotCreateRequestResolved={onResolved} />
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <AddOnCollection pluginId={PLUGIN_ID} title="Bots" kind={BOT_KIND.id} call={call} refreshKey={version} handOver={false} />
      </div>
    </div>
  );
}
/** The Bots collection's New button opens the bot setup chat. */
function NewBotListener() {
  const navigate = useBbNavigate();
  useEffect(() => {
    const open = (event: Event) => {
      event.preventDefault();
      navigate.toPluginPanel("bots", { subPath: "new" });
    };
    window.addEventListener(NEW_BOT_EVENT, open);
    return () => window.removeEventListener(NEW_BOT_EVENT, open);
  }, [navigate]);
  return null;
}
export default definePluginApp((app) => {
  for (const icon of botTeamsIcons) app.experimental_icons.register(icon);
  app.composer.customize({
    id: "thread-profile",
    scopes: ["thread", "new-thread"],
    actions: [{ id: "profile", component: ProfilePicker }],
  });
  app.slots.navPanel({
    id: "bots",
    title: "Teams",
    icon: "Bot",
    path: "bots",
    component: retainPanel("bots", BotsPage),
    headerContent: StudioBarSlot,
  });
  // A Space's Command view, opened from the Space's ⋯ menu in the sidebar (Navigation hides its row).
  app.slots.navPanel({ id: "command", title: "Command", icon: "GridView", path: "command", component: retainPanel("command", CommandPage), headerContent: StudioBarSlot });
  app.slots.experimental_appOverlay({ id: "thread-badges", component: ThreadBadges });
  app.slots.experimental_appOverlay({ id: "studio-new-bot", component: NewBotListener });
  app.slots.experimental_appOverlay({ id: "companions", component: () => <>
    <FloatPanels path="bots" render={subPath => <BotsPage subPath={subPath} />} />
  </> });
});
