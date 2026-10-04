import { BarCrumb, BarSeparator, CompanionOutlet, companionWorkbenchAvailable, ICON_BUTTON, Icon, PageColumn, StudioBar } from "@bb-studio/kit/app";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useFloatState, update } from "./store";
import { closeTab, moveCompanion, pinTab } from "./stack";
import { TabLabel } from "./Panel";
import { LegacyCompanionOutlet } from "./LegacyCompanion";

export function MainView({ subPath }: { subPath: string }) {
  const state = useFloatState();
  const navigate = useBbNavigate();
  let key = subPath;
  try { key = decodeURIComponent(subPath); } catch { /* malformed paths do not match a tab */ }
  const tab = state.tabs.find((candidate) => candidate.key === subPath) ?? state.tabs.find((candidate) => candidate.key === key);
  if (!tab || tab.placement !== "main") {
    return <PageColumn className="max-w-2xl pt-6">
      <StudioBar><nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center"><BarCrumb current>Companions</BarCrumb></nav></StudioBar>
      {state.tabs.length ? <div className="space-y-px">{state.tabs.map((candidate) => <button key={candidate.key} type="button" className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-state-hover"
        onClick={() => {
          update((next) => moveCompanion(next, candidate.key, "main"));
          navigate.toPluginPanel("companions", { subPath: candidate.key });
        }}><Icon name="AppWindow" className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 truncate"><TabLabel target={candidate.target} /></span></button>)}</div>
        : <p className="text-sm text-muted-foreground">Open Chat or float a view to keep it beside your work.</p>}
    </PageColumn>;
  }
  const move = (placement: "floating" | "workbench") => update((next) => moveCompanion(next, tab.key, placement));
  return <div className="flex h-full min-h-0 flex-col">
    <StudioBar>
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5">
        <BarCrumb onClick={() => navigate.toPluginPanel("companions")} title="Back to Companions">Companions</BarCrumb>
        <BarSeparator />
        <BarCrumb current><span className="truncate"><TabLabel target={tab.target} /></span></BarCrumb>
      </nav>
      <div className="flex shrink-0 items-center gap-0.5">
        {companionWorkbenchAvailable() ? <button type="button" aria-label="Move to workbench" title="Move to workbench" className={ICON_BUTTON} onClick={() => move("workbench")}><Icon name="PanelRight" className="size-4" /></button> : null}
        <button type="button" aria-label="Float" title="Float" className={ICON_BUTTON} onClick={() => move("floating")}><Icon name="AppWindow" className="size-4" /></button>
        <button type="button" aria-label="Pin" title={tab.pinned ? "Unpin" : "Pin"} aria-pressed={Boolean(tab.pinned)} className={ICON_BUTTON} onClick={() => update((next) => pinTab(next, tab.key, !tab.pinned))}><Icon name={tab.pinned ? "PinOff" : "Pin"} className="size-4" /></button>
        <button type="button" aria-label="Close" title="Close" className={ICON_BUTTON} onClick={() => update((next) => closeTab(next, tab.key))}><Icon name="X" className="size-4" /></button>
      </div>
    </StudioBar>
    {companionWorkbenchAvailable() ? <CompanionOutlet id={tab.key} /> : <LegacyCompanionOutlet id={tab.key} />}
  </div>;
}
