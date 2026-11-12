// The app's side of the workbench tools (src/workbench-agent), always mounted
// in BB's main window: hears each command on WORKBENCH_CHANNEL, and when this
// window shows that conversation, claims it, runs it (exec.ts) and replies.
// It also takes the new mark off a tab opened behind the selected one once
// the user selects it (clearSeenMark).
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef } from "react";
import { renameTabOf, workbenchOf } from "../../kit/app/host-sdk";
import { errorMessage } from "../../kit/format";
import type { workbenchContract } from "../contract";
import { setTabNavigator, requestPluginTab } from "../../ui/tab-open";
import { adaptWorkbench, clearSeenMark, runOp, type WorkbenchLike } from "../exec";
import { commandSchema, WORKBENCH_CHANNEL, type WorkbenchCommand } from "../shared";

/** How often the selected tab is checked for a new mark to take off. */
const MARK_CHECK_MS = 1000;

export interface BridgeDeps {
  workbench(threadId: string): WorkbenchLike | null;
  claim(requestId: string): Promise<boolean>;
  reply(requestId: string, message: string, record: WorkbenchCommand["record"]): Promise<unknown>;
}

/** Handles one realtime payload. Answers the conversation whose workbench this window ran it on, or null. */
export async function handleCommand(payload: unknown, deps: BridgeDeps): Promise<string | null> {
  const parsed = commandSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { requestId, threadId, op, record } = parsed.data;
  if (!deps.workbench(threadId)) return null;
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

export function WorkbenchAgentBridge() {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof workbenchContract>();
  const latest = useRef({ navigate, rpc });
  latest.current = { navigate, rpc };
  // Conversations the agent used the workbench of here, besides the main view's: where new marks may be.
  const threads = useRef(new Set<string>());
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
    }).then((threadId) => { if (threadId) threads.current.add(threadId); });
  });
  // Opens from outside React (a drop on the workbench, a New Tab row) use BB's navigation (src/ui/tab-open.ts).
  useEffect(() => setTabNavigator(navigate), [navigate]);
  useEffect(() => {
    const timer = setInterval(() => {
      const nav = latest.current.navigate;
      const rename = renameTabOf(nav);
      if (!rename) return;
      const seen = new Set<string>();
      for (const wb of [workbenchOf(nav), ...[...threads.current].map((threadId) => workbenchOf(nav, threadId))]) {
        if (!wb || seen.has(wb.threadId)) continue;
        seen.add(wb.threadId);
        clearSeenMark(wb, (tab) => { rename({ tab: { id: tab.tabId }, ...(tab.params !== null ? { params: tab.params } : {}), title: tab.title }); });
      }
    }, MARK_CHECK_MS);
    return () => clearInterval(timer);
  }, []);
  return null;
}
