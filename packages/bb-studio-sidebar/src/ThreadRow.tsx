// One thread's two-line row, its sub-threads nested below it, and its menu
// (right-click or the hover ⋯).
import { useThreadBadge } from "@bb-studio/kit/app";
import {
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Icon,
} from "@bb-studio/kit/ui";
import { ThreadTitle, useSidebarThreadShortcut } from "@get-bb/plugin-sdk/app";
import { createContext, useContext, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { compactAge, threadState, type StudioSpace, type Thread, type ThreadNode, type ThreadState } from "./model.js";
import { CHIEF_DIALOG_EVENT, type ThreadLine } from "./studio.js";

/** A lead, the Chief of Staff (the default Space's lead), or a pinned thread: a mark where others have a dot. */
export type RowMark = { kind: "lead" | "chief"; label: string } | { kind: "pinned" };

/** What every row needs from the list. */
export interface RowContextValue {
  activeThreadId: string | null;
  lines: Readonly<Record<string, ThreadLine>>;
  marks: Readonly<Record<string, RowMark>>;
  collapsed: ReadonlySet<string>;
  toggleCollapsed(threadId: string): void;
  spaces: readonly StudioSpace[];
  spaceIdOf(thread: Thread): string | null;
  leads: Readonly<Record<string, string | null>>;
  hidden: ReadonlySet<string>;
  setHidden(threadId: string, hidden: boolean): void;
  moveThreads(threadIds: readonly string[], space: StudioSpace): Promise<void>;
  setLead(spaceId: string, threadId: string | null): void;
  actions: {
    open(threadId: string, options?: { split?: boolean }): void;
    setPinned(threadId: string, pinned: boolean): Promise<void>;
    setRead(threadId: string, read: boolean): Promise<void>;
    rename(threadId: string, title: string): Promise<void>;
    archive(threadId: string): void;
    requestDelete(threadId: string): void;
  };
  onNavigate(): void;
}

export const RowContext = createContext<RowContextValue | null>(null);

export const THREAD_DRAG_TYPE = "application/x-bb-studio-thread";

const DOT: Record<ThreadState, { className: string; label: string | null }> = {
  "needs-you": { className: "bg-warning ring-[3px] ring-warning/30", label: "Needs you" },
  working: { className: "bg-success ring-[3px] ring-success/20", label: "Working" },
  error: { className: "bg-destructive ring-[3px] ring-destructive/30", label: "Unread error" },
  unread: { className: "bg-blue-500 ring-[3px] ring-blue-500/30", label: "Unread result" },
  // A read, idle thread has no dot, so a thread that wants you stands out.
  idle: { className: "invisible", label: null },
};
const MARK_TONE: Record<ThreadState, string> = {
  "needs-you": "text-warning", working: "text-success", error: "text-destructive", unread: "text-blue-500", idle: "text-subtle-foreground",
};
/** A thread that waits on you shows why in a pill instead of its age. */
const PILL: Partial<Record<ThreadState, { className: string; label: string }>> = {
  "needs-you": { className: "bg-warning text-neutral-950", label: "Needs you" },
  error: { className: "bg-destructive text-white", label: "Failed" },
  unread: { className: "bg-blue-500 text-white", label: "Done" },
};
const LINE_TONE: Record<ThreadLine["kind"], string> = {
  progress: "text-subtle-foreground", failure: "text-destructive/80", blocked: "text-warning/80",
};

function StatusMark({ state, mark }: { state: ThreadState; mark: RowMark | undefined }) {
  const status = DOT[state].label;
  if (!mark) {
    return (
      <span
        data-space-thread-dot={state}
        data-sidebar-needs-you={state === "needs-you" ? "" : undefined}
        role={status ? "img" : undefined}
        aria-label={status ?? undefined}
        aria-hidden={status ? undefined : true}
        title={status ?? undefined}
        className={cn("mx-[4.5px] size-[7px] shrink-0 rounded-full", DOT[state].className)}
      />
    );
  }
  const label = [mark.kind === "pinned" ? "Pinned" : mark.label, status].filter(Boolean).join(" · ");
  return (
    <span data-space-thread-mark={mark.kind} data-space-thread-dot={state} role="img" aria-label={label} title={label} className="inline-flex size-4 shrink-0 items-center justify-center">
      <Icon
        name={mark.kind === "pinned" ? "Pin" : mark.kind === "chief" ? "UserRound" : "Star"}
        aria-hidden
        className={cn("size-3", MARK_TONE[state], mark.kind === "lead" && "fill-current")}
      />
    </span>
  );
}

/** A Studio app's mark before the title, such as the avatar of the bot the thread works as. */
function ThreadBadge({ threadId }: { threadId: string }) {
  const badge = useThreadBadge(threadId);
  if (!badge) return null;
  return <span data-sidebar-thread-badge="" role="img" aria-label={badge.label} title={badge.label} className="flex size-4 shrink-0 items-center justify-center text-[13px] leading-none">{badge.glyph}</span>;
}

/** A thread, then its sub-threads unless folded. */
export function ThreadTree({ node, depth = 0 }: { node: ThreadNode; depth?: number }) {
  const ctx = useContext(RowContext)!;
  const folded = ctx.collapsed.has(node.thread.id);
  return (
    <>
      <ThreadRow node={node} depth={depth} />
      {folded ? null : node.children.map((child) => <ThreadTree key={child.thread.id} node={child} depth={depth + 1} />)}
    </>
  );
}

function ThreadRow({ node, depth }: { node: ThreadNode; depth: number }) {
  const ctx = useContext(RowContext)!;
  const { thread } = node;
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const state = threadState(thread);
  const mark = ctx.marks[thread.id];
  const line = ctx.lines[thread.id];
  const at = Math.max(thread.updatedAt, thread.latestAttentionAt, line?.at ?? 0);
  const active = ctx.activeThreadId === thread.id;
  const folded = ctx.collapsed.has(thread.id);
  const pill = PILL[state];
  const isLead = Object.values(ctx.leads).includes(thread.id);
  const loud = state === "needs-you" || state === "error" || state === "unread";

  const open = (split: boolean) => {
    ctx.actions.open(thread.id, split ? { split: true } : undefined);
    ctx.onNavigate();
  };

  const row = (
    <div
      data-sidebar-thread-id={thread.id}
      data-active={active ? "" : undefined}
      draggable={!isLead && !renaming}
      onDragStart={(event) => {
        event.dataTransfer.setData(THREAD_DRAG_TYPE, thread.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "group/thread-row relative flex cursor-pointer flex-col rounded-md py-1 pr-1 text-sm transition-colors",
        active ? "bg-sidebar-accent text-sidebar-foreground" : "hover:bg-sidebar-accent/60",
      )}
      style={{ paddingLeft: 4 + depth * 16 }}
      onClick={(event) => { if (!renaming) open(event.metaKey || event.ctrlKey); }}
      onAuxClick={(event) => { if (event.button === 1) open(true); }}
    >
      <div className="flex h-5 min-w-0 items-center gap-1.5">
        {node.children.length ? (
          <button
            type="button"
            aria-label={folded ? "Show sub-threads" : "Hide sub-threads"}
            aria-expanded={!folded}
            onClick={(event) => { event.stopPropagation(); ctx.toggleCollapsed(thread.id); }}
            className="-ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-subtle-foreground hover:text-sidebar-foreground"
          >
            <Icon name={folded ? "ChevronRight" : "ChevronDown"} className="size-3" aria-hidden />
          </button>
        ) : null}
        <StatusMark state={state} mark={mark} />
        <ThreadBadge threadId={thread.id} />
        {renaming ? (
          <RenameInput thread={thread} onDone={() => setRenaming(false)} />
        ) : (
          <a
            href={thread.href}
            onClick={(event) => event.preventDefault()}
            draggable={false}
            className={cn(
              "bb-thread-title min-w-0 flex-1 truncate outline-none",
              loud ? "font-semibold text-sidebar-foreground" : state === "idle" && !active ? "text-muted-foreground" : "text-sidebar-foreground",
            )}
          >
            <ThreadTitle threadId={thread.id} />
          </a>
        )}
        {shortcut ? <span aria-hidden className="shrink-0 rounded bg-sidebar-accent px-1 text-[10px] text-muted-foreground">{shortcut.label}</span> : null}
        <span className={cn("shrink-0", !menuOpen && "group-hover/thread-row:hidden", menuOpen && "hidden")}>
          {pill ? (
            <span data-space-thread-pill={state} className={cn("whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide", pill.className)}>{pill.label}</span>
          ) : (
            <time data-space-thread-time="" dateTime={new Date(at).toISOString()} className="whitespace-nowrap text-xs tabular-nums text-subtle-foreground">{compactAge(at)}</time>
          )}
        </span>
        <span className={cn("shrink-0", menuOpen ? "flex" : "hidden group-hover/thread-row:flex max-md:pointer-coarse:flex")}>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for ${thread.displayTitle}`}
                onClick={(event) => event.stopPropagation()}
                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <Icon name="MoreHorizontal" className="size-3.5" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-48" onClick={(event) => event.stopPropagation()}>
              <ThreadMenu thread={thread} kit={DROPDOWN} onRename={() => setRenaming(true)} />
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <span
        data-space-thread-line={line?.kind}
        className={cn("pointer-events-none min-w-0 truncate pl-[22px] text-xs leading-4", line ? LINE_TONE[line.kind] : "")}
      >
        {line?.text ?? " "}
      </span>
    </div>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={renaming}>{row}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-48" onClick={(event) => event.stopPropagation()}>
        <ThreadMenu thread={thread} kit={CONTEXT} onRename={() => setRenaming(true)} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RenameInput({ thread, onDone }: { thread: Thread; onDone(): void }) {
  const ctx = useContext(RowContext)!;
  const [value, setValue] = useState(thread.title ?? thread.displayTitle);
  const commit = () => {
    const title = value.trim();
    onDone();
    if (!title || title === thread.title) return;
    ctx.actions.rename(thread.id, title).catch((error: unknown) => toast.error(`Couldn't rename: ${error instanceof Error ? error.message : String(error)}`));
  };
  return (
    <input
      autoFocus
      aria-label="Thread title"
      value={value}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") commit();
        if (event.key === "Escape") onDone();
      }}
      className="h-5 min-w-0 flex-1 rounded-sm border border-input bg-background px-1 text-sm outline-none focus:border-ring"
    />
  );
}

/** The menu primitives for a right-click menu or the ⋯ dropdown. */
interface MenuKit {
  Item: typeof DropdownMenuItem | typeof ContextMenuItem;
  Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
  Sub: typeof DropdownMenuSub;
  SubTrigger: typeof DropdownMenuSubTrigger | typeof ContextMenuSubTrigger;
  SubContent: typeof DropdownMenuSubContent | typeof ContextMenuSubContent;
}
const DROPDOWN: MenuKit = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator, Sub: DropdownMenuSub, SubTrigger: DropdownMenuSubTrigger, SubContent: DropdownMenuSubContent };
const CONTEXT: MenuKit = { Item: ContextMenuItem, Separator: ContextMenuSeparator, Sub: ContextMenuSub, SubTrigger: ContextMenuSubTrigger, SubContent: ContextMenuSubContent };

/** The default Space's house; drawn here since stable BB has no house icon. */
export function HomeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

export function SpaceGlyph({ space }: { space: StudioSpace }) {
  if (space.isDefault) return <HomeMark className="size-4" />;
  return space.icon
    ? <span aria-hidden className="w-4 text-center text-[13px] leading-none">{space.icon}</span>
    : <span aria-hidden className="mx-1 size-2 rounded-full" style={{ background: space.color }} />;
}

function ThreadMenu({ thread, kit, onRename }: { thread: Thread; kit: MenuKit; onRename(): void }) {
  const ctx = useContext(RowContext)!;
  const { Item, Separator, Sub, SubTrigger, SubContent } = kit;
  const spaceId = ctx.spaceIdOf(thread);
  const top = ctx.spaces.find((space) => space.isDefault) ?? null;
  const isChief = top !== null && ctx.leads[top.id] === thread.id;
  // Space lead is for the other Spaces; the default Space's lead is the Chief of Staff.
  const leadSpaceId = spaceId !== null && spaceId !== top?.id ? spaceId : null;
  const isLead = leadSpaceId !== null && ctx.leads[leadSpaceId] === thread.id;
  const isRoot = thread.parentThreadId === null;
  const failed = (verb: string) => (error: unknown) => toast.error(`Couldn't ${verb}: ${error instanceof Error ? error.message : String(error)}`);
  const item = (icon: string, label: string, onSelect: () => void, destructive = false) => (
    <Item onSelect={onSelect} className={destructive ? "text-destructive focus:text-destructive" : undefined}>
      <Icon name={icon} aria-hidden />{label}
    </Item>
  );
  const check = (label: string, checked: boolean, onSelect: () => void, disabled = false) => (
    <Item aria-checked={checked} disabled={disabled} onSelect={onSelect}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked ? <Icon name="Check" className="ml-auto" aria-hidden /> : null}
    </Item>
  );
  return (
    <>
      {item("PanelRight", "Open in split", () => { ctx.actions.open(thread.id, { split: true }); ctx.onNavigate(); })}
      {item(thread.isPinned ? "PinOff" : "Pin", thread.isPinned ? "Unpin" : "Pin", () => void ctx.actions.setPinned(thread.id, !thread.isPinned).catch(failed("pin")))}
      {item(thread.isUnread ? "Check" : "Circle", thread.isUnread ? "Mark as read" : "Mark as unread", () => void ctx.actions.setRead(thread.id, thread.isUnread).catch(failed("mark it")))}
      {item("Edit", "Rename", onRename)}
      {item("Copy", "Copy link", () => {
        void navigator.clipboard.writeText(new URL(thread.href, window.location.origin).toString()).then(() => toast.success("Link copied"), failed("copy the link"));
      })}
      {isRoot && ctx.spaces.length > 1 && !thread.isArchived ? (
        <>
          <Separator />
          <Sub>
            <SubTrigger><Icon name="Layers" aria-hidden />Move to Space</SubTrigger>
            <SubContent className="max-h-[min(24rem,calc(100vh-2rem))] min-w-44 overflow-y-auto">
              {ctx.spaces.map((space) => (
                <Item key={space.id} disabled={space.id === spaceId} aria-current={space.id === spaceId ? "true" : undefined} onSelect={() => void ctx.moveThreads([thread.id], space)}>
                  <SpaceGlyph space={space} />
                  <span className="min-w-0 flex-1 truncate">{space.isDefault ? "Home" : space.name}</span>
                  {space.id === spaceId ? <Icon name="Check" className="ml-auto" aria-hidden /> : null}
                </Item>
              ))}
            </SubContent>
          </Sub>
        </>
      ) : null}
      {isRoot || isChief || isLead ? (
        <Sub>
          <SubTrigger><Icon name="Star" aria-hidden />Promote</SubTrigger>
          <SubContent className="min-w-44">
            {check("Space lead", isLead, () => { if (leadSpaceId) ctx.setLead(leadSpaceId, isLead ? null : thread.id); }, isChief || !leadSpaceId)}
            {check("Chief of Staff", isChief, () => { if (top) ctx.setLead(top.id, isChief ? null : thread.id); }, !top)}
          </SubContent>
        </Sub>
      ) : null}
      {isChief ? item("Clock", "Heartbeat…", () => {
        if (window.dispatchEvent(new Event(CHIEF_DIALOG_EVENT, { cancelable: true }))) toast.error("Open Studio to set the Chief of Staff's heartbeat.");
      }) : null}
      {isRoot && !isLead && !isChief ? (
        ctx.hidden.has(thread.id)
          ? item("Eye", "Unhide", () => ctx.setHidden(thread.id, false))
          : item("EyeOff", "Hide", () => ctx.setHidden(thread.id, true))
      ) : null}
      <Separator />
      {/* A lead can't be archived until it's demoted. */}
      {isLead || isChief ? null : item("Archive", "Archive", () => ctx.actions.archive(thread.id))}
      {item("Trash2", "Delete…", () => ctx.actions.requestDelete(thread.id), true)}
    </>
  );
}

export function RowProvider({ value, children }: { value: RowContextValue; children: ReactNode }) {
  return <RowContext.Provider value={value}>{children}</RowContext.Provider>;
}
