import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { Bots } from "./bot";
import { markWelcomeOpened, readFlag, runOnboarding, welcomeThreadOf, type OnboardingProviderState } from "./onboarding";

export const ONBOARDING_POLL_MS = 5_000;

export function forkHooks(bb: { experimental_hooks?: object }): boolean {
  const hooks = bb.experimental_hooks;
  return !!hooks && Object.entries(hooks).some(([key, value]) => key === "experimental_threadForkPoint" && typeof value === "function");
}

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
        dataDir, db: deps.db, sdk: bb.sdk as never, providers, idleThreads: forkHooks(bb as { experimental_hooks?: object }),
        seedBot: (input) => deps.bots.seedStarter(input),
        startFirstChat: (input) => deps.bots.startFirstChat(input),
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
    const flag = readFlag(dataDir);
    const welcome = welcomeThreadOf(dataDir);
    const bot = welcome ? deps.bots.stored(welcome.botId) : null;
    return {
      threadId: welcome && bot ? welcome.threadId : null, opened: welcome?.opened ?? true, pending: flag?.state !== "done",
      bot: bot ? { id: bot.id, name: bot.name, primary: !!bot.primary, presence: deps.bots.presenceOf(bot.id), appearance: bot.appearance ?? null } : null,
    };
  };
  return {
    bot_welcome: () => welcomeView(),
    bot_welcome_opened: () => ({ ok: markWelcomeOpened(dataDir) }),
  };
}
