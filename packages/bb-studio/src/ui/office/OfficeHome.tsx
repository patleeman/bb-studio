// Home of a Space. One box to start work or hand it off, then three things in
// order of urgency: what needs you, what the team is doing, what came back.
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
} from "@get-bb/plugin-sdk/app";
import { Icon, PageColumn, openAppPath } from "@bb-studio/kit/app";
import type { ReactNode } from "react";
import { useState } from "react";
import { Face } from "./Face";
import { InboxRow } from "./InboxRow";
import { useCall, useLive, useTeam, type Home, type Space, type TeamBot, type WorkingTask } from "./model";
import { openOffice } from "./routes";
import { SpaceMark } from "./SpaceSwitcher";
import { cn } from "./styles";

const SHOWN_REPORTS = 5;

function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-8">
      <h2 className="mb-1 flex items-baseline text-sm font-medium text-muted-foreground">
        {title}
        {action ? <span className="ml-auto">{action}</span> : null}
      </h2>
      {children}
    </section>
  );
}

const STATUS: Record<WorkingTask["status"], { label: string; tone: string }> = {
  working: { label: "Working", tone: "text-success-foreground" },
  waiting: { label: "Needs you", tone: "text-warning-foreground" },
  review: { label: "Ready for review", tone: "text-foreground" },
  done: { label: "Done", tone: "text-muted-foreground" },
};

export function TaskRow({ task, bot }: { task: WorkingTask; bot: TeamBot | undefined }) {
  const status = STATUS[task.status];
  return (
    <li className="border-b border-border last:border-b-0">
      <button type="button" onClick={() => openAppPath(task.href)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-state-hover/50">
        {bot ? <Face name={bot.name} avatar={bot.avatar} state={bot.state} /> : <span className="size-8 shrink-0 rounded-full bg-muted" />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{task.title}</span>
            {task.recurring ? <span className="flex shrink-0 items-center gap-1 rounded border border-border px-1 text-[11px] font-normal text-muted-foreground"><Icon name="Repeat" className="size-3" aria-hidden />{task.recurring}</span> : null}
          </span>
          <span className="block truncate text-sm text-muted-foreground">{bot?.name ?? "Bot"}{task.note ? ` · ${task.note}` : ""}</span>
        </span>
        <span className={cn("shrink-0 text-xs", status.tone)}>{status.label}</span>
      </button>
    </li>
  );
}

export function OfficeHome({ space }: { space: Space }) {
  const call = useCall();
  const threadActions = useSidebarThreadActions();
  const home = useLive<Home>("home", { spaceId: space.id }, { pollMs: 30_000 });
  const { bots } = useTeam(space.id);
  const botById = new Map(bots.map((bot) => [bot.id, bot]));
  const [notice, setNotice] = useState<string | null>(null);

  const needs = home.data?.needsYou ?? [];
  const working = home.data?.working ?? [];
  const reports = home.data?.reports ?? [];
  const recent = home.data?.recent ?? [];
  const today = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  return (
    <PageColumn className="max-w-3xl">
      <header className="flex items-center gap-3">
        <SpaceMark space={space} />
        <h1 className="text-2xl font-semibold">{space.name}</h1>
        <span className="ml-auto text-sm text-muted-foreground">{today}</span>
      </header>

      <div className="mt-6 rounded-lg border border-border bg-background">
        <NewThreadComposer
          layout="contained"
          draftKey={`office-home:${space.id}`}
          placeholder="Start a thread, or @mention a bot to hand it off"
          {...(space.defaultProjectId ? { defaultProjectId: space.defaultProjectId } : {})}
          onSubmit={async (request) => {
            const result = await call("office_start", { spaceId: space.id, request }) as { threadId?: string; taskId?: string; botId?: string };
            if (result.threadId) threadActions.open(result.threadId);
            else if (result.botId) { setNotice(`${botById.get(result.botId)?.name ?? "The bot"} is on it. You'll hear back in your Inbox.`); home.refresh(); }
          }}
        />
      </div>
      {notice ? <p role="status" className="mt-2 text-sm text-muted-foreground">{notice}</p> : null}
      {home.error && !home.data ? <p role="alert" className="mt-4 text-sm text-destructive">{home.error}</p> : null}

      <Block title="Needs you">
        {needs.length
          ? <ul>{needs.map((event) => <InboxRow key={event.key} event={event} bot={event.botId ? botById.get(event.botId) : undefined} onChanged={home.refresh} />)}</ul>
          : home.data ? <p className="py-2 text-sm text-muted-foreground">Nothing is waiting on you.</p> : null}
      </Block>

      {working.length
        ? <Block title="Your team is working on">
            <ul>{working.map((task) => <TaskRow key={task.id} task={task} bot={botById.get(task.botId)} />)}</ul>
          </Block>
        : null}

      {reports.length
        ? <Block
            title="Reports"
            action={reports.length > SHOWN_REPORTS ? <button type="button" onClick={() => openOffice("inbox")} className="text-sm text-muted-foreground hover:text-foreground">All reports</button> : null}
          >
            <ul>{reports.slice(0, SHOWN_REPORTS).map((event) => <InboxRow key={event.key} event={event} bot={event.botId ? botById.get(event.botId) : undefined} onChanged={home.refresh} />)}</ul>
          </Block>
        : null}

      {recent.length
        ? <Block title="Recent work">
            <ul>
              {recent.slice(0, 8).map((item) => {
                const author = item.authorBotId ? botById.get(item.authorBotId) : undefined;
                return (
                  <li key={`${item.pluginId}:${item.id}`}>
                    <button type="button" onClick={() => openAppPath(item.href)} className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 text-left text-sm hover:bg-state-hover">
                      <span className="min-w-0 flex-1 truncate">{item.title || "Untitled"}</span>
                      {author ? <Face name={author.name} avatar={author.avatar} size="sm" /> : null}
                      <span className="shrink-0 text-xs text-muted-foreground">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(item.updatedAt))}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Block>
        : null}
    </PageColumn>
  );
}
