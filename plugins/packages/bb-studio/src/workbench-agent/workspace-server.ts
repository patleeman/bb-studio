// The server side of each conversation's Workspace: the store
// (src/workbench-agent/store.ts) behind the public RPCs
// (workspace-contract.ts), the desktop's one-time import, and the change
// event every client listens to. The agent tools write through the same
// service (server.ts), so the phone and the desktop see what the agent opens.
import { cleanRef, mobileSupportOf, refComplete, type WorkspaceTabRef } from "./workspace";
import type { WorkspaceChanged, WorkspaceMutateInput, WorkspaceMutateOutput, WorkspaceStateView } from "./workspace-contract";
import type { Actor, ImportedTab, MutateOp, MutateOutcome, WorkspaceState, WorkspaceStore } from "./store";

export function stateView(state: WorkspaceState): WorkspaceStateView {
  return {
    threadId: state.threadId,
    tabs: state.tabs.map((tab) => ({ tabId: tab.tabId, ref: cleanRef(tab.ref), title: tab.title, position: tab.position, openedBy: tab.openedBy, openedAt: tab.openedAt, mobileSupport: mobileSupportOf(tab.ref) })),
    activeTabId: state.activeTabId,
    panelOpen: state.panelOpen,
    version: state.version,
  };
}

export class WorkspaceService {
  constructor(
    readonly store: WorkspaceStore,
    private readonly publish: (event: WorkspaceChanged) => void,
    /** Fills in what a client left out of a ref (a file's environment or host). */
    private readonly completeRef: (threadId: string, ref: WorkspaceTabRef) => Promise<WorkspaceTabRef> = async (_threadId, ref) => ref,
    private readonly checks: {
      /** Whether BB has the thread: clients can't make a Workspace for one that doesn't exist. */
      threadExists(threadId: string): Promise<boolean>;
      /** Why a ref's worktree or machine isn't there; null when it is (or it names none). */
      placeProblem(ref: WorkspaceTabRef): Promise<string | null>;
    } = { threadExists: async () => true, placeProblem: async () => null },
    private readonly now: () => number = Date.now,
  ) {}

  /** When a desktop window, and when a phone, last said it shows each conversation. */
  private readonly shown = new Map<string, { desktop: number | null; phone: number | null }>();
  static readonly SHOWN_MS = 12_000;

  /** A window or a phone reports the conversations it shows: `origin` "phone:<device id>" counts as the phone, any other as a desktop window. */
  markShown(threadIds: readonly string[], origin: string | null = null): void {
    const at = this.now();
    const phone = origin?.startsWith("phone:") ?? false;
    for (const threadId of threadIds.slice(0, 50)) {
      const was = this.shown.get(threadId) ?? { desktop: null, phone: null };
      this.shown.delete(threadId);
      this.shown.set(threadId, phone ? { ...was, phone: at } : { ...was, desktop: at });
    }
    while (this.shown.size > 500) this.shown.delete(this.shown.keys().next().value!);
  }

  /** Where the conversation was shown in the last few seconds: a desktop window first, else the phone, else null. */
  shownOn(threadId: string): "desktop" | "phone" | null {
    const seen = this.shown.get(threadId);
    const recent = (at: number | null) => at !== null && this.now() - at <= WorkspaceService.SHOWN_MS;
    return recent(seen?.desktop ?? null) ? "desktop" : recent(seen?.phone ?? null) ? "phone" : null;
  }

  /** Whether a desktop window or the phone showed the conversation in the last few seconds. */
  isShown(threadId: string): boolean {
    return this.shownOn(threadId) !== null;
  }

  forget(threadId: string): void {
    this.shown.delete(threadId);
    this.store.deleteThread(threadId);
  }

  get(threadId: string): WorkspaceState {
    return this.store.get(threadId);
  }

  private announce(state: WorkspaceState, origin: string | null): void {
    try { this.publish({ threadId: state.threadId, version: state.version, origin, tabCount: state.tabs.length }); } catch { /* a client re-reads on its next look */ }
  }

  async mutate(threadId: string, change: MutateOp, by: Actor, options: { baseVersion?: number; origin?: string | null } = {}): Promise<MutateOutcome> {
    const op = change.op === "open" || change.op === "update" ? { ...change, tab: await this.completeRef(threadId, change.tab) } : change;
    if (op.op === "open" || op.op === "update") {
      const problem = await this.checks.placeProblem(op.tab);
      if (problem) {
        const tabId = op.op === "update" ? op.tabId : null;
        return { result: "refused", tabId, message: problem, created: false, state: this.store.get(threadId) };
      }
    }
    const outcome = this.store.mutate(threadId, op, by, options.baseVersion);
    if (outcome.result === "ok") this.announce(outcome.state, options.origin ?? (by === "agent" ? "agent" : null));
    return outcome;
  }

  async importOnce(threadId: string, tabs: readonly ImportedTab[], activeIndex: number | null, panelOpen: boolean | null, origin: string | null): Promise<{ imported: boolean; state: WorkspaceState }> {
    if (!(await this.checks.threadExists(threadId))) return { imported: false, state: this.store.get(threadId) };
    const completed: ImportedTab[] = [];
    for (const tab of tabs) {
      const ref = await this.completeRef(threadId, tab.ref);
      if (!(await this.checks.placeProblem(ref))) completed.push({ ...tab, ref });
    }
    const result = this.store.importOnce(threadId, completed, activeIndex, panelOpen);
    if (result.imported) this.announce(result.state, origin);
    return result;
  }

  /** threadWorkbenchMutate: one op from a client (the phone or a desktop window), always as the user. */
  async rpcMutate(input: WorkspaceMutateInput): Promise<WorkspaceMutateOutput> {
    const bad = (message: string): WorkspaceMutateOutput => ({ ...stateView(this.store.get(input.threadId)), result: "refused", tabId: null, message });
    if (!(await this.checks.threadExists(input.threadId))) return bad(`No thread has id ${JSON.stringify(input.threadId)}.`);
    let change: MutateOp;
    switch (input.op) {
      case "open":
        if (!input.tab) return bad("open needs tab.");
        if (!refComplete(input.tab as WorkspaceTabRef)) return bad(`A ${input.tab.kind} tab needs its ${input.tab.kind === "browser" ? "url" : input.tab.kind === "terminal" ? "terminalId" : input.tab.kind === "plugin" ? "pluginId and tabId" : "path"}.`);
        change = { op: "open", tab: input.tab as WorkspaceTabRef, title: input.title ?? "", ...(input.focus !== undefined ? { focus: input.focus } : {}), ...(input.position !== undefined ? { position: input.position } : {}) };
        break;
      case "close": case "focus":
        if (!input.tabId) return bad(`${input.op} needs tabId.`);
        change = { op: input.op, tabId: input.tabId };
        break;
      case "reorder":
        if (!input.tabId || input.position === undefined) return bad("reorder needs tabId and position.");
        change = { op: "reorder", tabId: input.tabId, position: input.position };
        break;
      case "update":
        if (!input.tabId || !input.tab) return bad("update needs tabId and tab.");
        change = { op: "update", tabId: input.tabId, tab: input.tab as WorkspaceTabRef, ...(input.title !== undefined ? { title: input.title } : {}) };
        break;
    }
    const outcome = await this.mutate(input.threadId, change, "user", { baseVersion: input.baseVersion, origin: input.origin ?? null });
    return { ...stateView(outcome.state), result: outcome.result, tabId: outcome.tabId, message: outcome.message };
  }
}
