// A bot is a face: a round avatar, never a row. A dashed ring turns while it
// works; a dot means it needs you. "A face is someone, a row is something."
import { cn } from "./styles";
import type { BotState } from "./model";

const SIZES = {
  xs: "size-4 text-[9px]",
  sm: "size-5 text-[11px]",
  md: "size-8 text-base",
  lg: "size-12 text-2xl",
} as const;

export interface FaceProps {
  name: string;
  avatar: string | null;
  state?: BotState;
  size?: keyof typeof SIZES;
  selected?: boolean;
  className?: string;
}

function isImage(avatar: string): boolean {
  return /^(https?:|data:image\/|\/)/.test(avatar);
}

export function Face({ name, avatar, state = "idle", size = "md", selected = false, className }: FaceProps) {
  const showState = size === "md" || size === "lg";
  const label = state === "needs_you" ? `${name}, needs you` : state === "working" ? `${name}, working` : name;
  return (
    <span role="img" aria-label={label} className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "inline-flex items-center justify-center overflow-hidden rounded-full bg-muted leading-none select-none",
          SIZES[size],
          selected && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-sidebar",
        )}
      >
        {avatar && isImage(avatar)
          ? <img src={avatar} alt="" className="size-full object-cover" />
          : <span aria-hidden>{avatar || name.slice(0, 1).toUpperCase()}</span>}
      </span>
      {showState && state === "working"
        ? <span aria-hidden className="pointer-events-none absolute -inset-[3px] rounded-full border-[1.5px] border-dashed border-success-foreground/80 motion-safe:animate-[spin_6s_linear_infinite]" />
        : null}
      {showState && state === "needs_you"
        ? <span aria-hidden className="absolute -top-px -right-px size-2.5 rounded-full border-2 border-sidebar bg-warning-foreground" />
        : null}
    </span>
  );
}

/** Small overlapping faces at the end of a row: who is in this conversation. */
export function FaceStack({ faces, max = 3 }: { faces: { name: string; avatar: string | null }[]; max?: number }) {
  const shown = faces.slice(0, max);
  const extra = faces.length - shown.length;
  return (
    <span className="flex shrink-0 items-center" aria-label={faces.map((face) => face.name).join(", ")}>
      {shown.map((face, index) => (
        <span key={`${face.name}-${index}`} className={cn("rounded-full ring-2 ring-sidebar", index > 0 && "-ml-1.5")}>
          <Face name={face.name} avatar={face.avatar} size="xs" />
        </span>
      ))}
      {extra > 0 ? <span className="ml-1 text-[10px] text-muted-foreground">+{extra}</span> : null}
    </span>
  );
}
