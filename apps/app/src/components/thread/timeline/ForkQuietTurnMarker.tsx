import { Icon } from "@bb/shared-ui/icon";

export function QuietTurnMarker() {
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-subtle-foreground"
      data-quiet-turn=""
    >
      <Icon name="Check" className="size-3 shrink-0" aria-hidden />
      <span>Quiet check</span>
    </div>
  );
}
