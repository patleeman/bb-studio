import { useState } from "react";
import { Icon } from "@bb/shared-ui/icon";

const ICONS = {
  done: { name: "Check", className: "size-3 shrink-0" },
  running: { name: "Spinner", className: "size-3 shrink-0 animate-spin" },
  skipped: { name: "Info", className: "size-3 shrink-0" },
  notice: { name: "Info", className: "size-3 shrink-0" },
  failed: { name: "AlertTriangle", className: "size-3 shrink-0" },
  alert: { name: "AlertTriangle", className: "size-3 shrink-0" },
} as const;

export interface QuietMarkerDetails {
  text: string;
  steps: string[];
  reply: string | null;
  full?: boolean;
}

function when(at: number | undefined): string | undefined {
  return at === undefined
    ? undefined
    : new Date(at).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function QuietTurnMarker({
  label = "Quiet check",
  state = "done",
  at,
  details,
}: {
  label?: string;
  state?: keyof typeof ICONS;
  at?: number;
  details?: QuietMarkerDetails;
}) {
  const [open, setOpen] = useState(false);
  const icon = ICONS[state];
  const head = (
    <>
      <Icon name={icon.name} className={icon.className} aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  if (details?.full) {
    return (
      <div
        className="px-2 py-0.5 text-xs text-subtle-foreground"
        data-quiet-turn={state}
        data-quiet-turn-full=""
        title={when(at)}
      >
        <div className="flex items-center gap-1.5">{head}</div>
        <p className="mt-1 ml-[1.125rem] whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {details.text}
        </p>
      </div>
    );
  }
  if (details === undefined) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-subtle-foreground"
        data-quiet-turn={state}
        title={when(at)}
      >
        {head}
      </div>
    );
  }
  return (
    <div
      className="px-2 py-0.5 text-xs text-subtle-foreground"
      data-quiet-turn={state}
    >
      <button
        type="button"
        className="flex max-w-full items-center gap-1.5 text-left hover:text-muted-foreground"
        aria-expanded={open}
        title={when(at)}
        onClick={() => setOpen((value) => !value)}
      >
        {head}
        <Icon
          name="ChevronRight"
          className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          className="mt-1 ml-[1.125rem] flex flex-col gap-1.5 border-l border-border-seam pl-3"
          data-quiet-turn-details=""
        >
          {details.text ? (
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {details.text}
            </p>
          ) : null}
          {details.steps.length > 0 ? (
            <ul className="flex flex-col gap-0.5" aria-label="What the Bot did">
              {details.steps.map((step, index) => (
                <li key={index} className="truncate">
                  {step}
                </li>
              ))}
            </ul>
          ) : null}
          {details.reply ? (
            <p className="whitespace-pre-wrap break-words">
              Replied: {details.reply}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
