// A Studio space's page widgets: live embeds of the space's recent items,
// threads, channels and messages, projects, and buttons that make things in
// it. Each is a `space` embed whose target is `<space id>/<section>`; Studio
// makes a space's page with all of them, and the user writes around them,
// moves them or removes them. Pages asks Studio for the data; Studio's own
// overlay shows the dialogs that change the space.
import { projectName, studioItemProps, studioThreadProps, useProjects } from "@bb-studio/kit/app";
import { plural, relativeTime } from "@bb-studio/kit/format";
import { Icon } from "@bb-studio/kit/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { SpaceWidgetView } from "../contract";
import { parseSpaceTarget, type SpaceSection } from "../schema-config";
import { usePagesUi, type PagesUi } from "./context";

// Studio's window events (packages/bb-studio/src/ids.ts).
const SPACE_DIALOG_EVENT = "studio:space-dialog";
const SPACE_CHANGED_EVENT = "studio:space-changed";
/** Every widget on a page asks; one request serves them all for a moment. */
const SHARED_MS = 3_000;
const POLL_MS = 30_000;
const SHOWN_THREADS = 6;

type SpaceThread = SpaceWidgetView["threads"][number];

export const SPACE_SECTION_LABELS: Record<SpaceSection, string> = {
  actions: "Create",
  recent: "Recent",
  threads: "Threads",
  channels: "Channels and messages",
  projects: "Projects",
};

const fetched = new Map<string, { at: number; view: Promise<SpaceWidgetView | null> }>();

function fetchSpace(ui: PagesUi, id: string, fresh: boolean): Promise<SpaceWidgetView | null> {
  const cached = fetched.get(id);
  if (!fresh && cached && Date.now() - cached.at < SHARED_MS) return cached.view;
  const view = ui.space(id);
  fetched.set(id, { at: Date.now(), view });
  view.catch(() => fetched.delete(id));
  return view;
}

/** A space's widget data, refetched when the space changes, the page is shown again, and now and then. */
function useSpace(id: string): SpaceWidgetView | null | undefined {
  const ui = usePagesUi();
  const [view, setView] = useState<SpaceWidgetView | null | undefined>(undefined);
  const load = useCallback(
    (fresh: boolean) => {
      fetchSpace(ui, id, fresh).then(setView, () => setView(null));
    },
    [ui, id],
  );
  useEffect(() => {
    load(false);
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ spaceId?: string }>).detail?.spaceId === id) load(true);
    };
    const shown = () => document.visibilityState === "visible" && load(false);
    const timer = setInterval(shown, POLL_MS);
    window.addEventListener(SPACE_CHANGED_EVENT, changed);
    document.addEventListener("visibilitychange", shown);
    return () => {
      clearInterval(timer);
      window.removeEventListener(SPACE_CHANGED_EVENT, changed);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [id, load]);
  return view;
}

/** Opens one of Studio's dialogs for the space. */
export function spaceDialog(spaceId: string, dialog: "edit" | "delete" | "items" | "threads" | "channels" | "projects") {
  const event = new CustomEvent(SPACE_DIALOG_EVENT, { detail: { spaceId, dialog }, cancelable: true });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) toast.error("Studio isn't available to change the space.");
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1.5">{children}</div>;
}

function FooterButton({ icon, children, onClick }: { icon?: string; children: ReactNode; onClick(): void }) {
  return (
    <button type="button" className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={onClick}>
      {icon ? <Icon name={icon} className="size-3.5" /> : null}
      {children}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3 text-xs text-muted-foreground/70">{children}</div>;
}

function Row({ icon, glyph, title, sub, aside, href, threadId, onOpen }: {
  icon: string;
  glyph?: string | null;
  title: string;
  sub: string;
  aside?: string;
  /** An item's, for the right-click menu. */
  href?: string;
  /** A thread's, for the right-click menu. */
  threadId?: string;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-state-hover"
      onClick={onOpen}
      {...(threadId ? studioThreadProps(threadId, title, { drag: false }) : studioItemProps(href ? { href, title, icon } : null, { drag: false }))}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        {glyph ? <span className="text-base leading-none">{glyph}</span> : <Icon name={icon} className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      {aside ? <span className="shrink-0 text-xs text-muted-foreground">{aside}</span> : null}
    </button>
  );
}

function threadIcon(thread: SpaceThread) {
  if (thread.status === "active" || thread.status === "starting") return "Loader";
  return thread.kind === "channel" ? "Hash" : thread.kind === "dm" ? "Bot" : "MessageSquare";
}

function Actions({ view }: { view: SpaceWidgetView }) {
  const ui = usePagesUi();
  const [busy, setBusy] = useState<string | null>(null);
  const make = async (kind: SpaceWidgetView["kinds"][number]) => {
    if (kind.event) {
      // An add-on's own dialog makes it, such as a bot.
      const event = new CustomEvent(kind.event, { detail: { projectId: view.space.defaultProjectId, spaceId: view.space.id }, cancelable: true });
      window.dispatchEvent(event);
      if (!event.defaultPrevented) toast.error(`Couldn't open the new ${kind.label.toLowerCase()} dialog.`);
      return;
    }
    setBusy(`${kind.pluginId}:${kind.id}`);
    try {
      const { href } = await ui.createInSpace({ id: view.space.id, pluginId: kind.pluginId, kind: kind.id });
      ui.openPath(href);
    } catch (cause) {
      toast.error(`Couldn't make a ${kind.label.toLowerCase()}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusy(null);
    }
  };
  const tile = "flex h-10 min-w-0 items-center gap-2.5 rounded-md border border-border bg-background px-3 text-left text-sm hover:bg-state-hover disabled:opacity-60";
  return (
    <>
      <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 lg:grid-cols-4">
        <button type="button" className={tile} onClick={() => ui.compose(view.threadPrompt)}>
          <Icon name="MessageSquarePlus" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Thread</span>
        </button>
        {view.kinds.map((kind) => (
          <button key={`${kind.pluginId}:${kind.id}`} type="button" className={tile} disabled={busy === `${kind.pluginId}:${kind.id}`} onClick={() => void make(kind)}>
            <Icon name={kind.icon} className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{kind.label}</span>
          </button>
        ))}
      </div>
      <Footer>
        <FooterButton icon="Plus" onClick={() => spaceDialog(view.space.id, "items")}>
          Add existing items
        </FooterButton>
        <span className="flex-1" />
        <FooterButton icon="Settings" onClick={() => spaceDialog(view.space.id, "edit")}>
          Space settings
        </FooterButton>
      </Footer>
    </>
  );
}

function Recent({ view }: { view: SpaceWidgetView }) {
  const ui = usePagesUi();
  return (
    <>
      <div className="py-1">
        {view.recent.map((item) => (
          <Row
            key={`${item.pluginId}:${item.id}`}
            icon={item.kindIcon}
            glyph={item.icon}
            title={item.title}
            sub={item.kindLabel}
            aside={relativeTime(item.updatedAt)}
            href={item.href}
            onOpen={() => ui.openPath(item.href)}
          />
        ))}
        {!view.recent.length ? <Empty>Nothing here yet.</Empty> : null}
      </div>
      <Footer>
        <FooterButton icon="Plus" onClick={() => spaceDialog(view.space.id, "items")}>
          Add items
        </FooterButton>
        {view.itemCount > view.recent.length ? (
          <FooterButton icon="ArrowUpRight" onClick={() => ui.openPath(view.itemsHref)}>
            Show all {view.itemCount} in Studio
          </FooterButton>
        ) : null}
      </Footer>
    </>
  );
}

function Threads({ view, conversations }: { view: SpaceWidgetView; conversations: boolean }) {
  const ui = usePagesUi();
  const projects = useProjects();
  const [all, setAll] = useState(false);
  const threads = view.threads.filter((thread) => (thread.kind !== "thread") === conversations);
  const shown = all ? threads : threads.slice(0, SHOWN_THREADS);
  const place = (thread: SpaceThread) =>
    thread.kind === "channel"
      ? "Channel"
      : thread.kind === "dm"
        ? `With ${thread.botName ?? "a bot"}`
        : thread.projectId
          ? projectName(projects, thread.projectId)
          : "No project";
  return (
    <>
      <div className="py-1">
        {shown.map((thread) => (
          <Row key={thread.id} icon={threadIcon(thread)} title={thread.title} sub={place(thread)} aside={relativeTime(thread.updatedAt)} threadId={thread.id} onOpen={() => ui.openThread(thread.id)} />
        ))}
        {!threads.length ? (
          <Empty>
            {conversations
              ? "No channels or messages yet."
              : "No threads yet."}
          </Empty>
        ) : null}
      </div>
      <Footer>
        {conversations ? (
          <FooterButton icon="Plus" onClick={() => spaceDialog(view.space.id, "channels")}>
            Add channel or message
          </FooterButton>
        ) : (
          <>
            <FooterButton icon="MessageSquarePlus" onClick={() => ui.compose(view.threadPrompt)}>
              New thread
            </FooterButton>
            <FooterButton icon="Plus" onClick={() => spaceDialog(view.space.id, "threads")}>
              Add threads
            </FooterButton>
          </>
        )}
        {threads.length > SHOWN_THREADS ? <FooterButton onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${threads.length}`}</FooterButton> : null}
      </Footer>
    </>
  );
}

function Projects({ view }: { view: SpaceWidgetView }) {
  const ui = usePagesUi();
  return (
    <>
      <div className="py-1">
        {view.projects.map((project) => (
          <Row
            key={project.id}
            icon="Folder"
            title={project.name}
            sub={`${plural(project.items, "item")} · ${plural(project.threads, "thread")}`}
            aside={project.isDefault ? "Default" : undefined}
            onOpen={() => ui.openProject(project.id)}
          />
        ))}
        {!view.projects.length ? <Empty>No projects yet.</Empty> : null}
      </div>
      <Footer>
        <FooterButton icon="Plus" onClick={() => spaceDialog(view.space.id, "projects")}>
          Add or remove projects
        </FooterButton>
      </Footer>
    </>
  );
}

/** A space widget, live; the section comes from its target. */
export function SpaceEmbed({ target }: { target: string }) {
  const { spaceId, section } = parseSpaceTarget(target);
  const view = useSpace(spaceId);
  if (!spaceId) return <Empty>Not linked to a space.</Empty>;
  if (view === undefined) return <Empty>Loading {SPACE_SECTION_LABELS[section].toLowerCase()}…</Empty>;
  if (view === null) return <Empty>Space unavailable.</Empty>;
  return (
    <div className="text-foreground" data-space-widget={section}>
      {section === "actions" ? <Actions view={view} /> : null}
      {section === "recent" ? <Recent view={view} /> : null}
      {section === "threads" ? <Threads view={view} conversations={false} /> : null}
      {section === "channels" ? <Threads view={view} conversations /> : null}
      {section === "projects" ? <Projects view={view} /> : null}
    </div>
  );
}

type AnyBlock = { type: string; props?: unknown; children?: readonly AnyBlock[] };

/** The space a page's widgets show, so the slash menu can add the ones the user removed. */
export function pageSpaceId(blocks: readonly AnyBlock[]): string | null {
  for (const block of blocks) {
    const props = block.props as { kind?: unknown; target?: unknown } | undefined;
    if (block.type === "embed" && props?.kind === "space" && typeof props.target === "string") {
      const { spaceId } = parseSpaceTarget(props.target);
      if (spaceId) return spaceId;
    }
    const nested = pageSpaceId(block.children ?? []);
    if (nested) return nested;
  }
  return null;
}
