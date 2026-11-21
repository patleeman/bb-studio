// Where the strands overview lives and whether it is on (Settings → Strands
// overview), kept apart from its UI so the sidebar can read them cheaply.
import { useStudioSettings } from "../../settings/ui/use-settings";

export const strandsPath = (botId: string) => `/plugins/studio/studio/bot/${encodeURIComponent(botId)}/strands`;
export const isStrandsPath = (pathname: string) => /^\/plugins\/studio\/studio\/bot\/[^/]+\/strands\/?$/.test(pathname);

export function useStrandsOverviewEnabled(): boolean {
  const { values } = useStudioSettings();
  return values?.strandsOverview === true;
}
