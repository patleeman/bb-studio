import { Icon } from "@bb/shared-ui/icon";

export function QuietTurnMarker({
  label = "Quiet check",
  at,
}: {
  label?: string;
  at?: number;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-subtle-foreground"
      data-quiet-turn=""
      title={
        at === undefined
          ? undefined
          : new Date(at).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })
      }
    >
      <Icon name="Check" className="size-3 shrink-0" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
