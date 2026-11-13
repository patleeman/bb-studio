import { BarTitle } from "../kit/app/index";

export type AppType = "saved" | "interactive";
export const APP_TYPE_LABELS: Record<AppType, string> = { saved: "Saved", interactive: "Interactive" };

export function AppTitle({ type, title, disabled = false, onRename }: { type: AppType; title: string; disabled?: boolean; onRename(title: string): void }) {
  return (
    <>
      <BarTitle title={title} label="App title" placeholder="Untitled app" disabled={disabled} onRename={onRename} />
      <span data-testid="app-type" data-type={type} aria-label={`${APP_TYPE_LABELS[type]} app`} title="App"
        className="shrink-0 rounded-sm border border-border px-1.5 py-px text-xs text-muted-foreground">{APP_TYPE_LABELS[type]}</span>
    </>
  );
}
