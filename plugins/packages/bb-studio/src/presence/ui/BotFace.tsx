import { ProviderLogo } from "../../ui/bot/BotAvatar";
import { useLive } from "../../ui/live";
import { BotPresence } from "./BotPresence";

export interface FaceProvider { id: string; logoUrl?: string | null }

export function BotFace({ botId, size, still = false, provider = null, className }: { botId: string; size: number; still?: boolean; provider?: FaceProvider | null; className?: string }) {
  const spaces = useLive("bot_spaces", {}, { pollMs: 60_000 });
  const bot = spaces.data?.bots.find((each) => each.id === botId) ?? null;
  const face = bot
    ? <BotPresence bot={bot} size={size} still={still} className={className} />
    : <span aria-hidden data-testid="bot-face-empty" className={`inline-flex shrink-0 ${className ?? ""}`} style={{ width: size, height: size }} />;
  if (!provider) return face;
  const badge = Math.max(12, Math.round(size * 0.45));
  return (
    <span className="relative inline-flex shrink-0" data-provider={provider.id}>
      {face}
      <span className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-full border border-border bg-background" style={{ width: badge, height: badge }} title={`Runs on ${provider.id}`}>
        <ProviderLogo provider={provider} className="size-[70%]" />
      </span>
    </span>
  );
}
