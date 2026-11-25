// The Workspace RPCs every client uses (the phone, each desktop window): read
// a conversation's tabs, and change them one op at a time against the version
// read. A stale baseVersion changes nothing and answers result "conflict"
// with the current state; the client re-reads (or uses that state) and
// tries again. Each change is announced on WORKSPACE_CHANGED_CHANNEL with
// the writer's origin, so a window can skip its own echo.
import { z } from "zod";
import { workspaceTabRefSchema } from "./workspace";

const threadId = z.string().min(1).max(200);
const tabId = z.string().min(1).max(100);
/** Who wrote: "desktop:<window id>", "phone:<device id>", "agent". Echoed on the change event. */
const origin = z.string().min(1).max(200);

export const workspaceTab = z.object({
  tabId: z.string(),
  ref: workspaceTabRefSchema,
  title: z.string(),
  /** 0-based place in the tab strip. */
  position: z.number().int().min(0),
  openedBy: z.enum(["user", "agent"]),
  openedAt: z.number(),
  /** How the phone shows it: native, the in-app web view, or a card to open it on the desktop. */
  mobileSupport: z.enum(["native", "web", "desktopOnly"]),
});

export const workspaceState = z.object({
  threadId: z.string(),
  /** The open tabs, in strip order. Info and Strands are the phone's own and never listed. */
  tabs: z.array(workspaceTab),
  activeTabId: z.string().nullable(),
  /** Whether the desktop side panel was last open; null when not known. */
  panelOpen: z.boolean().nullable(),
  /** 0 until anything was stored for the conversation; each change adds one. */
  version: z.number().int().min(0),
});

export const WORKSPACE_OPS = ["open", "close", "focus", "reorder", "update"] as const;

export const workspaceContract = {
  /** A conversation's Workspace (its workbench tabs). */
  threadWorkbenchGet: {
    input: z.object({ threadId }),
    output: workspaceState,
  },
  /**
   * One change, made only when `baseVersion` is the current version.
   * open: `tab` (and `title`; `focus` default true, `position` optional),
   * selects it when it is already open. close, focus: `tabId`. reorder:
   * `tabId` to `position`. update: `tabId` now shows `tab` (and `title`),
   * such as a browser tab that navigated. Browser tabs are http(s) only,
   * paths have no "..", and a file's worktree or machine must exist:
   * anything else is refused. Answers the state after it (or as it is, for
   * conflict, notFound, refused and unchanged) and the tab acted on.
   */
  threadWorkbenchMutate: {
    input: z.object({
      threadId,
      baseVersion: z.number().int().min(0),
      op: z.enum(WORKSPACE_OPS),
      tab: workspaceTabRefSchema.optional(),
      title: z.string().max(300).optional(),
      tabId: tabId.optional(),
      position: z.number().int().min(0).max(500).optional(),
      focus: z.boolean().optional(),
      origin: origin.optional(),
    }),
    output: workspaceState.extend({
      result: z.enum(["ok", "unchanged", "conflict", "notFound", "refused"]),
      /** The tab opened or acted on; null when there is none. */
      tabId: z.string().nullable(),
      /** Why it was refused, not found or in conflict; null otherwise. */
      message: z.string().nullable(),
    }),
  },
  /**
   * The conversations a client shows now, sent every few seconds while it
   * shows them (the server forgets one after 12 s without). `origin`
   * "phone:<device id>" counts as the phone, "desktop:<window id>" as a BB
   * window. The agent tools use it to say whether a change is on screen.
   */
  threadWorkbenchShown: {
    input: z.object({ threadIds: z.array(threadId).max(50), origin }),
    output: z.object({ ok: z.boolean() }),
  },
};

export type WorkspaceStateView = z.infer<typeof workspaceState>;
export type WorkspaceMutateInput = z.infer<typeof workspaceContract.threadWorkbenchMutate.input>;
export type WorkspaceMutateOutput = z.infer<typeof workspaceContract.threadWorkbenchMutate.output>;

/** Realtime: a conversation's Workspace changed. Read it again unless `origin` is yours. */
export const WORKSPACE_CHANGED_CHANNEL = "workbench-changed";
export const workspaceChanged = z.object({
  threadId: z.string(),
  version: z.number().int().min(0),
  origin: z.string().nullable(),
  /** Open tabs after the change, for the conversation row's count. */
  tabCount: z.number().int().min(0),
});
export type WorkspaceChanged = z.infer<typeof workspaceChanged>;
export const workspaceEvents = { [WORKSPACE_CHANGED_CHANNEL]: workspaceChanged };
