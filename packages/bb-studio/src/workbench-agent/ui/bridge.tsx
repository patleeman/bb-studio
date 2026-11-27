// The app's side of the workbench tools (src/workbench-agent), always mounted
// in BB's main window: hears each command on WORKBENCH_CHANNEL, and when this
// window shows that conversation, claims it, runs it (exec.ts) and replies.
// It also takes the new mark off a tab opened behind the selected one once
// the user selects it (clearSeenMark), and keeps each conversation's
// workbench on screen here the same as its Workspace on the server, both
// ways (sync.ts), bringing this window's stored tabs over once (import.ts).
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef } from "react";
import { renameTabOf, workbenchOf } from "../../kit/app/host-sdk";
import { errorMessage } from "../../kit/format";
import type { workbenchContract, workspaceRpcContract } from "../contract";
import { setTabNavigator, requestPluginTab } from "../../ui/tab-open";
import { adaptWorkbench, clearSeenMark, runOp, type WorkbenchLike } from "../exec";
import { commandSchema, WORKBENCH_CHANNEL, type WorkbenchCommand } from "../shared";
import { refKey, refOfPanelTab, sameKey } from "../workspace";
import { WORKSPACE_CHANGED_CHANNEL, workspaceChanged } from "../workspace-contract";
import { IMPORT_DONE_KEY, importStoredPanels } from "./import";
import { localSnapshots, WorkspaceSync, type WorkspaceClient } from "./sync";

/** How often the selected tab is checked for a new mark to take off. */
const MARK_CHECK_MS = 1000;
/** Every how many checks the window reports the conversations it shows (well inside the server's 12 s). */
const SHOWN_EVERY = 4;

export interface BridgeDeps {
  workbench(threadId: string): WorkbenchLike | null;
  claim(requestId: string): Promise<boolean>;
  reply(requestId: string, message: string, record: WorkbenchCommand["record"]): Promise<unknown>;
  /** Brings this window's workbench up to the Workspace now (ui/sync.ts). */
  syncNow?(threadId: string): Promise<void>;
}

/** Handles one realtime payload. Answers the conversation whose workbench this window ran it on, or null. */
export async function handleCommand(payload: unknown, deps: BridgeDeps): Promise<string | null> {
  const parsed = commandSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { requestId, threadId, op, record } = parsed.data;
  const shown = deps.workbench(threadId);
  if (!shown) return null;
  // pop_out names the Workspace's tab: this window finds its own key for what it shows.
  // A tab the Workspace has but this window hasn't opened yet (the sync runs every second): sync once, then look again.
  if (op.type === "popOut" && op.item) {
    const item = op.item;
    const find = () => deps.workbench(threadId)?.list().tabs.find((each) => { const ref = refOfPanelTab(each); return !!ref && sameKey(refKey(ref), item); });
    let tab = find();
    if (!tab && deps.syncNow) { await deps.syncNow(threadId).catch(() => {}); tab = find(); }
    if (!tab) {
      if (await deps.claim(requestId).catch(() => false)) await deps.reply(requestId, "That tab isn't in this window's workbench yet (BB couldn't show it here). Nothing changed.", record).catch(() => {});
      return null;
    }
    op.key = tab.key;
  }
  if (!(await deps.claim(requestId).catch(() => false))) return null;
  // Read again: the claim took a round trip.
  const wb = deps.workbench(threadId);
  if (!wb) {
    await deps.reply(requestId, "The conversation left the screen before its workbench could be changed. Nothing changed.", record).catch(() => {});
    return null;
  }
  try {
    const result = await runOp(wb, op, record);
    await deps.reply(requestId, result.message, result.record);
  } catch (error) {
    await deps.reply(requestId, `The workbench call failed: ${errorMessage(error)}`, record).catch(() => {});
  }
  return threadId;
}

/** This window's name in the Workspace's change events, so it can skip its own. */
const WINDOW_ORIGIN = `desktop:${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

export function WorkbenchAgentBridge() {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof workbenchContract & typeof workspaceRpcContract>();
  const latest = useRef({ navigate, rpc });
  latest.current = { navigate, rpc };
  // Conversations the agent used the workbench of here, besides the main view's: where new marks may be.
  const threads = useRef(new Set<string>());
  const sync = useRef<WorkspaceSync | null>(null);
  if (!sync.current) {
    const client: WorkspaceClient = {
      get: (threadId) => latest.current.rpc.call("threadWorkbenchGet", { threadId }),
      mutate: (input) => latest.current.rpc.call("threadWorkbenchMutate", input),
      importOnce: (input) => latest.current.rpc.call("workbench.import", input),
    };
    sync.current = new WorkspaceSync(WINDOW_ORIGIN, client, localSnapshots(typeof localStorage === "undefined" ? null : localStorage));
  }
  const workbenchFor = (threadId?: string): WorkbenchLike | null => {
    const nav = latest.current.navigate;
    const host = workbenchOf(nav, threadId);
    if (!host) return null;
    const id = host.threadId;
    return adaptWorkbench(host, (spec, options) => requestPluginTab({ pluginId: spec.tab.pluginId!, tabId: spec.tab.id, params: spec.params ?? null, title: spec.title ?? "" }, { threadId: id, ...options }));
  };
  const syncThread = (threadId?: string) => {
    const wb = workbenchFor(threadId);
    const host = workbenchOf(latest.current.navigate, threadId);
    if (!wb || !host || host.threadId.startsWith("page:")) return;
    threads.current.add(host.threadId);
    void sync.current!.sync(host.threadId, wb).catch(() => {});
  };
  // Another window, the phone or the agent changed a Workspace: follow it here when it is on screen.
  useRealtime(WORKSPACE_CHANGED_CHANNEL, (payload) => {
    const event = workspaceChanged.safeParse(payload);
    if (event.success && sync.current!.changed(event.data)) syncThread(event.data.threadId);
  });
  // Once per window profile: every stored side panel to the server (applied only where it has nothing yet).
  useEffect(() => {
    if (typeof localStorage === "undefined" || localStorage.getItem(IMPORT_DONE_KEY)) return;
    let stopped = false;
    void (async () => {
      const done = await importStoredPanels(localStorage, (panel) => latest.current.rpc.call("workbench.import", { ...panel, origin: WINDOW_ORIGIN }), () => stopped);
      // Done only when the server took the calls (or there was nothing): a failed start tries again on the next load.
      if (!stopped && done) localStorage.setItem(IMPORT_DONE_KEY, String(Date.now()));
    })();
    return () => { stopped = true; };
  }, []);
  useRealtime(WORKBENCH_CHANNEL, (payload) => {
    const { navigate: nav, rpc: client } = latest.current;
    void handleCommand(payload, {
      workbench: (threadId) => {
        const host = workbenchOf(nav, threadId);
        if (!host) return null;
        // A Visual Chat board is Visual Chat's tab: it opens it (src/ui/tab-open.ts).
        return adaptWorkbench(host, (spec, options) => requestPluginTab({ pluginId: spec.tab.pluginId!, tabId: spec.tab.id, params: spec.params ?? null, title: spec.title ?? "" }, { threadId, ...options }));
      },
      claim: async (requestId) => (await client.call("workbench.claim", { requestId })).go,
      reply: (requestId, message, record) => client.call("workbench.reply", { requestId, message, record }),
      syncNow: async (threadId) => { const wb = workbenchFor(threadId); if (wb) await sync.current!.sync(threadId, wb); },
    }).then((threadId) => { if (threadId) threads.current.add(threadId); });
  });
  // Opens from outside React (a drop on the workbench, a New Tab row) use BB's navigation (src/ui/tab-open.ts).
  useEffect(() => setTabNavigator(navigate), [navigate]);
  useEffect(() => {
    let tick = 0;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      tick++;
      const nav = latest.current.navigate;
      const rename = renameTabOf(nav);
      const seen = new Set<string>();
      for (const wb of [workbenchOf(nav), ...[...threads.current].map((threadId) => workbenchOf(nav, threadId))]) {
        if (!wb || seen.has(wb.threadId)) continue;
        seen.add(wb.threadId);
        if (rename) clearSeenMark(wb, (tab) => { rename({ tab: { id: tab.tabId }, ...(tab.params !== null ? { params: tab.params } : {}), title: tab.title }); });
        syncThread(wb.threadId);
      }
      // Every few seconds: which conversations this window shows, so the agent tools can say whether a change is on screen.
      const shown = [...seen].filter((threadId) => !threadId.startsWith("page:")).slice(0, 50);
      if (shown.length && tick % SHOWN_EVERY === 1) void latest.current.rpc.call("threadWorkbenchShown", { threadIds: shown, origin: WINDOW_ORIGIN }).catch(() => {});
    }, MARK_CHECK_MS);
    return () => clearInterval(timer);
  }, []);
  return null;
}
