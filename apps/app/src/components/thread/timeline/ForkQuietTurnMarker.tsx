import { Icon } from "@bb/shared-ui/icon";

const ICONS = {
  done: { name: "Check", className: "size-3 shrink-0" },
  running: { name: "Spinner", className: "size-3 shrink-0 animate-spin" },
  skipped: { name: "Info", className: "size-3 shrink-0" },
} as const;

export function QuietTurnMarker({
  label = "Quiet check",
  state = "done",
  at,
}: {
  label?: string;
  state?: keyof typeof ICONS;
  at?: number;
}) {
  const icon = ICONS[state];
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-subtle-foreground"
      data-quiet-turn={state}
      title={
        at === undefined
          ? undefined
          : new Date(at).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short",
            })
      }
    >
      <Icon name={icon.name} className={icon.className} aria-hidden />
      <span>{label}</span>
    </div>
  );
}
