import { CompanionOutlet, companionWorkbenchAvailable, Icon, openAppPath } from "@bb-studio/kit/app";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useFloatState, update } from "./store";
import { closeTab, moveCompanion, pinTab } from "./stack";
import { TabLabel } from "./Panel";

export function MainView({ subPath }: { subPath: string }) {
  const state = useFloatState();
  const navigate = useBbNavigate();
  let key = subPath;
  try { key = decodeURIComponent(subPath); } catch { /* malformed paths do not match a tab */ }
  const tab = state.tabs.find((candidate) => candidate.key === key);
  if (!tab || tab.placement !== "main" || !companionWorkbenchAvailable()) {
    return <div className="flex h-full flex-col gap-3 p-6">
      <h1 className="text-xl font-semibold">Companions</h1>
      {state.tabs.length ? state.tabs.map((candidate) => <button key={candidate.key} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-state-hover"
        onClick={() => {
          if (companionWorkbenchAvailable()) {
            update((next) => moveCompanion(next, candidate.key, "main"));
            navigate.toPluginPanel("companions", { subPath: encodeURIComponent(candidate.key) });
          } else if (candidate.target.kind === "thread") navigate.toThread(candidate.target.threadId);
          else openAppPath(candidate.target.path, { main: true });
        }}><Icon name="AppWindow" className="size-4" /><TabLabel target={candidate.target} /></button>) : <p className="text-sm text-muted-foreground">Open Chat or float a view to keep it beside your work.</p>}
    </div>;
  }
  const move = (placement: "floating" | "workbench") => update((next) => moveCompanion(next, tab.key, placement));
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium"><TabLabel target={tab.target} /></span>
      <button className="rounded-md px-2 py-1 text-sm hover:bg-state-hover" onClick={() => move("workbench")}>Workbench</button>
      <button className="rounded-md px-2 py-1 text-sm hover:bg-state-hover" onClick={() => move("floating")}>Float</button>
      <button className="rounded-md px-2 py-1 text-sm hover:bg-state-hover" onClick={() => update((next) => pinTab(next, tab.key, !tab.pinned))}>{tab.pinned ? "Unpin" : "Pin"}</button>
      <button className="rounded-md px-2 py-1 text-sm hover:bg-state-hover" onClick={() => update((next) => closeTab(next, tab.key))}>Close</button>
    </div>
    <CompanionOutlet id={tab.key} />
  </div>;
}
