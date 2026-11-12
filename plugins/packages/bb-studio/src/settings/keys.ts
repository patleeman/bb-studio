// The only settings BB still draws for Studio: API keys, which must stay in
// BB's secret files (0600, never sent to a browser). In this order on the
// settings page; Studio's own sections (ui/sections.tsx) follow them.
import { DECISIONS_KEY_SETTINGS } from "../decisions/settings";
import { OPENAI_KEY_SETTINGS } from "../openai-key";

export const STUDIO_KEY_SETTINGS = {
  ...OPENAI_KEY_SETTINGS,
  decisions_openRouterApiKey: DECISIONS_KEY_SETTINGS.decisions_openRouterApiKey,
  decisions_typesafeApiKey: DECISIONS_KEY_SETTINGS.decisions_typesafeApiKey,
  decisions_vercelApiKey: DECISIONS_KEY_SETTINGS.decisions_vercelApiKey,
  decisions_zenApiKey: DECISIONS_KEY_SETTINGS.decisions_zenApiKey,
  decisions_customJevApiKey: DECISIONS_KEY_SETTINGS.decisions_customJevApiKey,
} as const;
