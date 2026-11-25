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
  ) {}

  get(threadId: string): WorkspaceState {
    return this.store.get(threadId);
  }

  private announce(state: WorkspaceState, origin: string | null): void {
    try { this.publish({ threadId: state.threadId, version: state.version, origin, tabCount: state.tabs.length }); } catch { /* a client re-reads on its next look */ }
  }

  async mutate(threadId: string, change: MutateOp, by: Actor, options: { baseVersion?: number; origin?: string | null } = {}): Promise<MutateOutcome> {
    const op = change.op === "open" ? { ...change, tab: await this.completeRef(threadId, change.tab) } : change;
    const outcome = this.store.mutate(threadId, op, by, options.baseVersion);
    if (outcome.result === "ok") this.announce(outcome.state, options.origin ?? (by === "agent" ? "agent" : null));
    return outcome;
  }

  async importOnce(threadId: string, tabs: readonly ImportedTab[], activeIndex: number | null, panelOpen: boolean | null, origin: string | null): Promise<{ imported: boolean; state: WorkspaceState }> {
    const completed = await Promise.all(tabs.map(async (tab) => ({ ...tab, ref: await this.completeRef(threadId, tab.ref) })));
    const result = this.store.importOnce(threadId, completed, activeIndex, panelOpen);
    if (result.imported) this.announce(result.state, origin);
    return result;
  }

  /** threadWorkbenchMutate: one op from a client (the phone or a desktop window), always as the user. */
  async rpcMutate(input: WorkspaceMutateInput): Promise<WorkspaceMutateOutput> {
    const bad = (message: string): WorkspaceMutateOutput => ({ ...stateView(this.store.get(input.threadId)), result: "refused", tabId: null, message });
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
    }
    const outcome = await this.mutate(input.threadId, change, "user", { baseVersion: input.baseVersion, origin: input.origin ?? null });
    return { ...stateView(outcome.state), result: outcome.result, tabId: outcome.tabId, message: outcome.message };
  }
}
