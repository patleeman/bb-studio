import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { Bots } from "./bot";
import { markWelcomeOpened, readFlag, readOnboarding, runOnboarding, welcomeThreadOf, type OnboardingProviderState } from "./onboarding";

export const ONBOARDING_POLL_MS = 5_000;

export function registerOnboarding(bb: BbPluginApi, deps: { db: Database.Database; bots: Bots; errorText(error: unknown): string }) {
  const dataDir = bb.server.experimental_dataDir;
  const providers = async (): Promise<readonly OnboardingProviderState[]> => {
    const { primaryHostId } = await bb.sdk.system.config();
    const { providers: states } = await bb.sdk.system.providerStates(primaryHostId ? { hostId: primaryHostId } : undefined);
    return states;
  };
  let busy = false;
  const tick = async () => {
    if (busy || !deps.db.open) return;
    busy = true;
    try {
      const flag = await runOnboarding({
        dataDir, db: deps.db, sdk: bb.sdk as never, providers,
        createBot: async (input) => {
          const made = (await deps.bots.create({ ...input, promptHidden: true })).bot;
          if (!made) throw new Error("The Bot wasn't made.");
          return { id: made.id, threadId: made.threadId ?? null };
        },
      });
      if (flag.state === "done" && flag.reason === "ran" && !flag.opened) bb.log.info(`Onboarding made ${flag.botId} and started its first chat in ${flag.welcomeThreadId}.`);
    } catch (error) {
      bb.log.warn(`Onboarding will try again: ${deps.errorText(error)}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => {
    if (readFlag(dataDir)?.state === "done") { clearInterval(timer); return; }
    void tick();
  }, ONBOARDING_POLL_MS);
  bb.onDispose(() => clearInterval(timer));
  const welcomeView = () => {
    const flag = readOnboarding(dataDir);
    if (!flag) return { threadId: null, opened: false, pending: true, bot: null };
    const welcome = welcomeThreadOf(dataDir);
    const bot = welcome ? deps.bots.stored(welcome.botId) : null;
    return {
      threadId: welcome && bot ? welcome.threadId : null, opened: welcome?.opened ?? true, pending: false,
      bot: bot ? { id: bot.id, name: bot.name, primary: !!bot.primary, presence: deps.bots.presenceOf(bot.id), appearance: bot.appearance ?? null } : null,
    };
  };
  return {
    bot_welcome: () => welcomeView(),
    bot_welcome_opened: () => ({ ok: markWelcomeOpened(dataDir) }),
  };
}
