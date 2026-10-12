// The Bot's drawn avatar: a solid shape in a color with two dot eyes. A Bot
// without a shape (made before avatars were drawn) shows its emoji.
import { BOT_SHAPES } from "../../bot-shapes";

export type BotShape = (typeof BOT_SHAPES)[number];
export { BOT_SHAPES };

export const BOT_COLORS = ["#5b8def", "#7c66dc", "#c862c6", "#e5484d", "#f2804a", "#f5b83d", "#46a758", "#2ba59a", "#3eb0d5", "#8d8d86", "#d9775c", "#1f9d75"] as const;
export const DEFAULT_SHAPE: BotShape = "blob";

/** Shapes on a 40×40 board; eyes sit near the middle of each. */
const PATHS: Record<BotShape, string> = {
  blob: "M20 3c8 0 15 5 16 13s-2 15-8 19-15 3-20-2S2 21 4 14 12 3 20 3Z",
  circle: "M20 3a17 17 0 1 1 0 34a17 17 0 1 1 0-34Z",
  triangle: "M20 4c1.6 0 2.7.8 3.6 2.3l13 23c1.6 2.8-.3 5.7-3.5 5.7H6.9c-3.2 0-5.1-2.9-3.5-5.7l13-23C17.3 4.8 18.4 4 20 4Z",
  hexagon: "M20 2.5l15 8.7v17.6L20 37.5 5 28.8V11.2Z",
  cloud: "M12 33a8 8 0 0 1-1.5-15.9A10 10 0 0 1 29.5 13 8.5 8.5 0 0 1 29 33Z",
  droplet: "M20 3c5 7 13 14 13 21a13 13 0 0 1-26 0C7 17 15 10 20 3Z",
  square: "M11 4h18a7 7 0 0 1 7 7v18a7 7 0 0 1-7 7H11a7 7 0 0 1-7-7V11a7 7 0 0 1 7-7Z",
  star: "M20 3l4.9 10 11 1.6-8 7.8 1.9 11L20 28.2 10.2 33.4l1.9-11-8-7.8 11-1.6Z",
  pill: "M13 9h14a11 11 0 0 1 0 22H13a11 11 0 0 1 0-22Z",
};
const EYES_Y: Partial<Record<BotShape, number>> = { triangle: 25, droplet: 24, cloud: 24, star: 21 };

export function isBotShape(value: string | null | undefined): value is BotShape {
  return !!value && (BOT_SHAPES as readonly string[]).includes(value);
}

/**
 * The Bot's motion, shared by its avatar and chat: eyes blink now and then and
 * look around while it works; messages ease in; the thinking dots pulse. All
 * of it stops under reduced motion.
 */
export const BOT_STYLES = `
@keyframes bb-bot-blink { 0%, 94%, 100% { transform: scaleY(1); } 97% { transform: scaleY(0.12); } }
@keyframes bb-bot-look { 0%, 100% { transform: translate(0, 0); } 20% { transform: translate(-1.3px, -0.4px); } 45% { transform: translate(1.3px, -0.4px); } 70% { transform: translate(0.4px, 0.5px); } }
@keyframes bb-bot-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes bb-bot-dot { 0%, 80%, 100% { opacity: 0.25; transform: translateY(0); } 40% { opacity: 0.9; transform: translateY(-2px); } }
@keyframes bb-bot-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.bb-bot-eyes, .bb-bot-pupils { transform-box: view-box; transform-origin: 50% 50%; }
.bb-bot-eyes { animation: bb-bot-blink 7s infinite; }
.bb-bot-working .bb-bot-eyes { animation-duration: 3.2s; }
.bb-bot-working .bb-bot-pupils { animation: bb-bot-look 2.6s ease-in-out infinite; }
.bb-bot-in { animation: bb-bot-in 220ms cubic-bezier(.2,.7,.2,1) both; }
.bb-bot-dot { animation: bb-bot-dot 1.2s ease-in-out infinite; }
.bb-bot-shimmer { background: linear-gradient(90deg, currentColor 0%, currentColor 40%, transparent 50%, currentColor 60%, currentColor 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; animation: bb-bot-shimmer 2.2s linear infinite; }
.bb-bot-shimmer { -webkit-text-fill-color: transparent; opacity: .75; }
@media (prefers-reduced-motion: reduce) {
  .bb-bot-eyes, .bb-bot-pupils, .bb-bot-in, .bb-bot-dot, .bb-bot-shimmer { animation: none !important; }
  .bb-bot-shimmer { -webkit-text-fill-color: currentColor; }
}
`;

export function BotAvatar({ shape, color, emoji, size = 28, className, working = false }: { shape?: string | null; color?: string | null; emoji: string; size?: number; className?: string; working?: boolean }) {
  if (!isBotShape(shape)) {
    return <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] leading-none ${className ?? ""}`} style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden>{emoji}</span>;
  }
  const y = EYES_Y[shape] ?? 20;
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={`shrink-0 ${working ? "bb-bot-working" : ""} ${className ?? ""}`} aria-hidden data-shape={shape} data-working={working || undefined}>
      <path d={PATHS[shape]} fill={color ?? BOT_COLORS[0]} />
      <g className="bb-bot-eyes" style={{ transformOrigin: `20px ${y}px` }}>
        <circle cx="15.5" cy={y} r="2.1" fill="#fff" />
        <circle cx="24.5" cy={y} r="2.1" fill="#fff" />
        <g className="bb-bot-pupils">
          <circle cx="15.9" cy={y + 0.3} r="1" fill="#111" />
          <circle cx="24.9" cy={y + 0.3} r="1" fill="#111" />
        </g>
      </g>
    </svg>
  );
}

/** A color picked from the name, so a new Bot's color "matches the name". */
export function colorForName(name: string): string {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return BOT_COLORS[hash % BOT_COLORS.length]!;
}
