// A Space as a project: the lead's chat in the middle, with the Space's
// Overview, Page and Thread as fixed tabs in the workbench beside it. Before
// the Space has a lead, BB's own composer starts one. The panel's root lists
// every Space.
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  ThreadChat,
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type NewThreadRequest,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@bb-studio/kit/ui";
import { GHOST_BUTTON, Icon, PageColumn } from "@bb-studio/kit/app";
import { useState } from "react";
import { NEW_SPACE_EVENT, SPACE_DIALOG_EVENT } from "../../ids";
import { useCall, useSpaceLead, useSpaces, type Cadence, type SpaceLead } from "./data";
import { HandoffDialog } from "./Handoff";
import { PageEmbed } from "./PageEmbed";
import { SPACES_PANEL, spaceIdOf } from "./routes";
import { MENU, MENU_ITEM, MENU_SEPARATOR, PORTAL_SCOPE } from "./styles";

export function SpacesPanel({ subPath }: PluginNavPanelProps) {
  const spaceId = spaceIdOf(subPath);
  return spaceId ? <SpaceView key={spaceId} spaceId={spaceId} /> : <SpaceList />;
}

function SpaceMarkGlyph({ icon, color }: { icon: string | null; color?: string }) {
  return icon
    ? <span className="text-base leading-none">{icon}</span>
    : <span aria-hidden className="size-2.5 rounded-full" style={{ background: color ?? "currentColor" }} />;
}

function SpaceList() {
  const { spaces } = useSpaces();
  const navigate = useBbNavigate();
  return (
    <PageColumn className="max-w-2xl">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-semibold">Spaces</h1>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(NEW_SPACE_EVENT, { cancelable: true }))} className={GHOST_BUTTON}><Icon name="Plus" className="size-4" />New Space</button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Each Space has a lead you talk to and a page it keeps current. Its threads, pages and projects live in it.</p>
      <div className="mt-6 space-y-1">
        {(spaces ?? []).map((space) => (
          <button key={space.id} type="button" onClick={() => navigate.toPluginPanel(SPACES_PANEL, { subPath: space.id })} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-state-hover">
            <span className="inline-flex size-5 items-center justify-center"><SpaceMarkGlyph icon={space.icon} color={space.color} /></span>
            <span className="flex-1 truncate font-medium">{space.name}</span>
            {space.description ? <span className="max-w-[50%] truncate text-xs text-muted-foreground">{space.description}</span> : null}
          </button>
        ))}
        {spaces && !spaces.length ? <p className="px-3 py-2 text-sm text-muted-foreground">No Spaces yet.</p> : null}
      </div>
    </PageColumn>
  );
}

const RUN_LABELS: Record<Cadence, string> = { hourly: "Hourly", daily: "Daily", weekdays: "Weekdays" };

/** Off, or a heartbeat: the lead checks the Space on a cadence and reports to the Inbox. */
function RunMenu({ lead, onChanged }: { lead: SpaceLead; onChanged: () => void }) {
  const call = useCall();
  const run = lead.run?.enabled ? lead.run : null;
  const set = (cadence: Cadence | null) => {
    void call("space_set_run", { spaceId: lead.spaceId, enabled: cadence !== null, cadence: cadence ?? run?.cadence ?? "daily" }).then(onChanged, onChanged);
  };
  return (
    <Menu.Root>
      <Menu.Trigger className={GHOST_BUTTON} title="Schedule the lead's check-ins">
        <Icon name="Repeat" className="size-4" />{run ? `${RUN_LABELS[run.cadence]} check-ins` : "Check-ins"}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content {...PORTAL_SCOPE} align="end" className={MENU}>
          <p className="max-w-64 px-2 pt-1 pb-1.5 text-xs text-muted-foreground">Schedule the lead to check in and report to your Inbox. Turning check-ins off does not stop running threads.</p>
          <Menu.RadioGroup value={run?.cadence ?? "off"} onValueChange={(value) => set(value === "off" ? null : value as Cadence)}>
            {(["off", "hourly", "daily", "weekdays"] as const).map((value) => (
              <Menu.RadioItem key={value} value={value} className={MENU_ITEM}>
                <span className="inline-flex size-3.5 items-center justify-center"><Menu.ItemIndicator><Icon name="Check" /></Menu.ItemIndicator></span>
                {value === "off" ? "Off" : RUN_LABELS[value]}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** "New thread" in a Space: BB's composer; the server starts it in the Space's folder and adds it to the Space. */
export function StartThreadDialog({ spaceId, name, defaultProjectId, onClose }: { spaceId: string; name: string; defaultProjectId: string | null; onClose: () => void }) {
  const call = useCall();
  const navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  const submit = async (request: NewThreadRequest) => {
    setError(null);
    try {
      const { threadId } = await call("space_thread_start", { spaceId, request }) as { threadId: string };
      navigate.toThread(threadId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  };
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
          <DialogTitle>New thread in {name}</DialogTitle>
          <DialogDescription>It joins the Space, so the lead sees it and it shows in the Overview.</DialogDescription>
          <NewThreadComposer {...(defaultProjectId ? { defaultProjectId } : {})} placeholder="What should this thread do?" draftKey={`space-thread:${spaceId}`} onSubmit={submit} />
          {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
          </DialogContent>
    </Dialog>
  );
}

const spaceDialog = (spaceId: string, dialog: "edit" | "items" | "threads" | "projects" | "delete") =>
  window.dispatchEvent(new CustomEvent(SPACE_DIALOG_EVENT, { detail: { spaceId, dialog } }));

function SpaceView({ spaceId }: { spaceId: string }) {
  const call = useCall();
  const lead = useSpaceLead(spaceId);
  const { spaces } = useSpaces();
  const { projects } = useSidebarThreads();
  const [error, setError] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const [starting, setStarting] = useState(false);
  const space = spaces?.find((entry) => entry.id === spaceId);
  const name = lead.data?.name ?? space?.name ?? "Space";
  const leadThreadId = lead.data?.leadThreadId ?? null;
  const startIn = lead.data?.defaultProjectId ?? space?.defaultProjectId ?? projects.find((project) => project.isPersonal)?.id ?? null;

  const start = async (request: NewThreadRequest) => {
    setError(null);
    try {
      await call("space_lead_setup", { spaceId, request });
      lead.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-4">
        <span className="mr-1 inline-flex size-5 items-center justify-center"><SpaceMarkGlyph icon={lead.data?.icon ?? space?.icon ?? null} color={lead.data?.color ?? space?.color} /></span>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h1>
        {lead.data && leadThreadId ? <RunMenu lead={lead.data} onChanged={lead.refresh} /> : null}
        <button type="button" onClick={() => setStarting(true)} className={GHOST_BUTTON}><Icon name="MessageSquarePlus" className="size-4" />New thread</button>
        <Menu.Root>
          <Menu.Trigger aria-label="Space options" title="Space options" className={GHOST_BUTTON}><Icon name="MoreHorizontal" className="size-4" /></Menu.Trigger>
          <Menu.Portal>
            <Menu.Content {...PORTAL_SCOPE} align="end" className={MENU}>
              {leadThreadId ? <Menu.Item className={MENU_ITEM} onSelect={() => setHandingOff(true)}><Icon name="Fork" />Hand off lead…</Menu.Item> : null}
              <Menu.Item className={MENU_ITEM} onSelect={() => spaceDialog(spaceId, "edit")}><Icon name="Edit" />Edit Space</Menu.Item>
              <Menu.Item className={MENU_ITEM} onSelect={() => spaceDialog(spaceId, "threads")}><Icon name="MessageSquare" />Manage threads</Menu.Item>
              <Menu.Item className={MENU_ITEM} onSelect={() => spaceDialog(spaceId, "items")}><Icon name="FileText" />Manage items</Menu.Item>
              <Menu.Item className={MENU_ITEM} onSelect={() => spaceDialog(spaceId, "projects")}><Icon name="Folder" />Manage folders</Menu.Item>
              <Menu.Separator className={MENU_SEPARATOR} />
              <Menu.Item className={`${MENU_ITEM} text-destructive [&_svg]:text-destructive`} onSelect={() => spaceDialog(spaceId, "delete")}><Icon name="Trash2" />Delete Space…</Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </header>
      {starting ? <StartThreadDialog spaceId={spaceId} name={name} defaultProjectId={startIn} onClose={() => setStarting(false)} /> : null}
      {leadThreadId
        ? <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 pb-4">
            {/* "inherit": send with the lead thread's own permission, not the composer's default. */}
            <ThreadChat key={leadThreadId} threadId={leadThreadId} variant="full" layout="contained" permissionPolicy="inherit" className="min-h-0 flex-1" />
            {startIn ? <HandoffDialog threadId={leadThreadId} projectId={startIn} open={handingOff} onOpenChange={setHandingOff} onDone={() => lead.refresh()} /> : null}
          </div>
        : lead.loading
          ? null
          : <div className="mx-auto w-full max-w-2xl px-6 pt-16">
              <h2 className="text-xl font-semibold">Start {name}'s lead</h2>
              <p className="mt-1 mb-5 text-sm text-muted-foreground">Tell the lead what this Space is about. It keeps the Space's page current, starts threads as the work needs, and you talk to it here.</p>
              <NewThreadComposer {...(startIn ? { defaultProjectId: startIn } : {})} placeholder="What's this Space about?" draftKey={`space-lead:${spaceId}`} onSubmit={start} />
              {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
            </div>}
    </div>
  );
}

/** Workbench tab: the Space's page, in the real Pages editor. */
export function SpacePageTab({ subPath }: PluginNavPanelProps) {
  const spaceId = spaceIdOf(subPath);
  const lead = useSpaceLead(spaceId);
  if (!spaceId) return <p className="p-4 text-sm text-muted-foreground">Open a Space to see its page.</p>;
  const pageId = lead.data?.pageId;
  if (pageId) return <PageEmbed pageId={pageId} />;
  return lead.loading ? null : <p className="p-4 text-sm text-muted-foreground">The Space's page appears here once it has one.</p>;
}
