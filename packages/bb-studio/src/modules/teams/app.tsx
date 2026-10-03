import { moduleComponent } from "../Notice";
import { useModuleRpc } from "../app";
import { moduleApp } from "../app";
import { ViewHeader, ViewsPage, LegacyChannelRedirect } from "./views";
import { affects } from "./realtime";
import { UsagePanel } from "./channel-workbench";
import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRealtime, useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { Bot, BotListItem, Conversation, Job } from "./contract";
import type { rpcContract } from "./client-contract";
import { AddOnCollection, CopyReferenceMenuItem, type ProviderCall } from "@bb-studio/kit/app";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import { Button } from "@bb-studio/kit/ui";
import { TabBar, ProfileForm, DocumentEditor, WorkList, ErrorMessage, message } from "./bot-ui";

import { Modal } from "./channel-controls";
import { ProfilePicker } from "./profile-picker";
import { ThreadBadges } from "./thread-badges";
import { ProfileThreads } from "./profile-threads";
import { BotCreateRequests } from "./bot-create-requests";
import { BotCreationThread } from "./bot-creation-thread";
import { BotChat } from "./bot-chat";
import { BOT_KIND, NEW_BOT_EVENT, PLUGIN_ID, botHref } from "./studio-provider";
import { Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, FloatPanels, retainPanel, ICON_BUTTON, Icon as KitIcon, ItemHeader, ItemTile, openAppPath, PageColumn, studioPath, useStudioPresent } from "@bb-studio/kit/app";

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
  const rpc = useModuleRpc<typeof rpcContract>("teams"),
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
    <div className="relative h-full min-h-0">
      <ItemHeader
        item={{ href, title: bot.name }}
        chatAction={bot.retired ? null : <BotChat key={id} id={id} disabled={pending} onError={setError} />}
        backLabel={studio ? "Studio" : "Bots"}
        onBack={() =>
          openAppPath(studio ? studioPath("bot") : `/plugins/${PLUGIN_ID}/bots`)
        }
        leading={<Badge label={statusLabel} tone={STATUS_TONES[botStatus]} />}
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
            <h1 className="truncate text-[32px] leading-tight font-semibold tracking-tight max-md:text-[28px]">{bot.name}</h1>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              @{bot.handle}
              {bot.description ? ` · ${bot.description}` : ""}
            </p>
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
          {tab === "usage" && <UsagePanel id={id} kind="bot" />}
          {tab === "activity" && (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-muted-foreground">
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
  const rpc = useModuleRpc<typeof rpcContract>("teams");
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
  const [id, section, rest] = subPath.split("/");
  if (id === "new" && section === "space")
    return <BotCreationThread key={`space:${rest}`} spaceId={rest ? decodeURIComponent(rest) : undefined} />;
  if (id === "new")
    return <BotCreationThread key="standalone" />;
  if (id === "new-group" || id === "group")
    return <LegacyChannelRedirect subPath={id === "group" ? section ?? "" : ""} />;
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
 * The bots as a Studio collection, like every add-on's page. With Studio
 * installed it hands over to Studio's, except while bot creation requests,
 * which Studio can't show, are waiting.
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
  const rpc = useModuleRpc<StudioSchemas["provider"]>("teams");
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
        <AddOnCollection pluginId={PLUGIN_ID} title="Bots" kind={BOT_KIND.id} call={call} refreshKey={version} handOver={!requests?.length} />
      </div>
    </div>
  );
}
/** Studio's New ▾ → Bot opens the bot setup chat. */
function NewBotListener() {
  const navigate = useBbNavigate();
  useEffect(() => {
    const open = (event: Event) => {
      event.preventDefault();
      // A space's page passes its space, so the new bot joins it.
      const spaceId = (event as CustomEvent<{ spaceId?: unknown } | null>).detail?.spaceId;
      navigate.toPluginPanel("bots", { subPath: typeof spaceId === "string" && spaceId ? `new/space/${encodeURIComponent(spaceId)}` : "new" });
    };
    window.addEventListener(NEW_BOT_EVENT, open);
    return () => window.removeEventListener(NEW_BOT_EVENT, open);
  }, [navigate]);
  return null;
}
export function registerApp(host: import("@get-bb/plugin-sdk/app").PluginAppBuilder) {
  const app = moduleApp(host, "teams");
  for (const icon of botTeamsIcons) app.experimental_icons.register(icon);
  app.composer.customize({
    id: "thread-profile",
    scopes: ["thread", "new-thread"],
    actions: [{ id: "profile", component: moduleComponent("teams", ProfilePicker) }],
  });
  app.slots.navPanel({
    id: "bots",
    title: "Teams",
    icon: "Bot",
    path: "bots",
    component: retainPanel("bots", BotsPage),
  });
  app.slots.navPanel({ id: "channels", title: "Channels", icon: "MessageSquare", path: "channels", component: retainPanel("channels", ViewsPage), headerContent: ViewHeader });
  app.slots.navPanel({ id: "former-views", title: "Channels", icon: "MessageSquare", path: "views", component: retainPanel("views", LegacyChannelRedirect) });
  app.slots.experimental_appOverlay({ id: "thread-badges", component: ThreadBadges });
  app.slots.experimental_appOverlay({ id: "studio-new-bot", component: NewBotListener });
  app.slots.experimental_appOverlay({ id: "companions", component: () => <>
    <FloatPanels path="bots" render={subPath => <BotsPage subPath={subPath} />} />
    <FloatPanels path="channels" render={(subPath, { companion }) => <div className="flex h-full min-h-0 flex-col">{companion ? <div className="flex shrink-0 items-center px-3 py-2"><ViewHeader subPath={subPath} /></div> : null}<div className="min-h-0 flex-1"><ViewsPage subPath={subPath} /></div></div>} />
    <FloatPanels path="views" render={subPath => <LegacyChannelRedirect subPath={subPath} />} />
  </> });
}

export default definePluginApp(registerApp);
