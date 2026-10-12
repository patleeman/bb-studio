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

export function BotAvatar({ shape, color, emoji, size = 28, className }: { shape?: string | null; color?: string | null; emoji: string; size?: number; className?: string }) {
  if (!isBotShape(shape)) {
    return <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] leading-none ${className ?? ""}`} style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden>{emoji}</span>;
  }
  const y = EYES_Y[shape] ?? 20;
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={`shrink-0 ${className ?? ""}`} aria-hidden data-shape={shape}>
      <path d={PATHS[shape]} fill={color ?? BOT_COLORS[0]} />
      <circle cx="15.5" cy={y} r="2.1" fill="#fff" />
      <circle cx="24.5" cy={y} r="2.1" fill="#fff" />
      <circle cx="15.9" cy={y + 0.3} r="1" fill="#111" />
      <circle cx="24.9" cy={y + 0.3} r="1" fill="#111" />
    </svg>
  );
}

/** A color picked from the name, so a new Bot's color "matches the name". */
export function colorForName(name: string): string {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return BOT_COLORS[hash % BOT_COLORS.length]!;
}
