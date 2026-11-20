import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { Bots } from "./bot";
import { markWelcomeOpened, readFlag, runOnboarding, welcomeThreadOf, type OnboardingProviderState } from "./onboarding";

export const ONBOARDING_POLL_MS = 5_000;
/** The longest wait between tries while onboarding keeps failing. */
export const ONBOARDING_MAX_BACKOFF_MS = 5 * 60_000;

/** The wait before the next try: the poll while it works, doubling with each failure in a row up to the cap. */
export function onboardingDelay(failures: number): number {
  return failures ? Math.min(ONBOARDING_POLL_MS * 2 ** failures, ONBOARDING_MAX_BACKOFF_MS) : ONBOARDING_POLL_MS;
}

/** What the user reads while onboarding can't finish: plain words, and when it tries again. */
export function onboardingProblem(error: string, delayMs: number): string {
  const wait = delayMs >= 60_000 ? `${Math.round(delayMs / 60_000)} min` : `${Math.round(delayMs / 1000)} s`;
  return `Your Bot's first chat didn't start yet (${error}). Trying again in ${wait}.`;
}

export function forkHooks(bb: { experimental_hooks?: object }): boolean {
  const hooks = bb.experimental_hooks;
  return !!hooks && Object.entries(hooks).some(([key, value]) => key === "experimental_threadForkPoint" && typeof value === "function");
}

export function registerOnboarding(bb: BbPluginApi, deps: { db: Database.Database; bots: Bots; errorText(error: unknown): string; firstBot?(): Promise<unknown> }) {
  const dataDir = bb.server.experimental_dataDir;
  const providers = async (): Promise<readonly OnboardingProviderState[]> => {
    const { primaryHostId } = await bb.sdk.system.config();
    const { providers: states } = await bb.sdk.system.providerStates(primaryHostId ? { hostId: primaryHostId } : undefined);
    return states;
  };
  let busy = false;
  // Failures in a row (the wait doubles with each), the last error logged, and what the user reads.
  let failures = 0;
  let logged: string | null = null;
  let problem: string | null = null;
  const tick = async () => {
    if (busy || !deps.db.open) return;
    busy = true;
    try {
      const flag = await runOnboarding({
        dataDir, db: deps.db, sdk: bb.sdk as never, providers, idleThreads: forkHooks(bb as { experimental_hooks?: object }),
        seedBot: (input) => deps.bots.seedStarter(input),
        ...(deps.firstBot ? { firstBot: deps.firstBot } : {}),
        startFirstChat: (input) => deps.bots.startFirstChat(input),
      });
      if (flag.state === "done" && flag.reason === "ran" && !flag.opened) bb.log.info(`Onboarding made ${flag.botId} and started its first chat in ${flag.welcomeThreadId}.`);
      failures = 0;
      logged = null;
      problem = null;
    } catch (error) {
      failures += 1;
      const text = deps.errorText(error);
      // One line per new error, not one every few seconds.
      if (text !== logged) bb.log.warn(`Onboarding will try again: ${text}`);
      logged = text;
      problem = onboardingProblem(text, onboardingDelay(failures));
    } finally {
      busy = false;
    }
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const loop = async () => {
    await tick();
    if (disposed || readFlag(dataDir)?.state === "done") return;
    timer = setTimeout(() => void loop(), onboardingDelay(failures));
  };
  void loop();
  bb.onDispose(() => { disposed = true; if (timer) clearTimeout(timer); });
  const welcomeView = () => {
    const flag = readFlag(dataDir);
    const welcome = welcomeThreadOf(dataDir);
    const bot = welcome ? deps.bots.stored(welcome.botId) : null;
    return {
      threadId: welcome && bot ? welcome.threadId : null, opened: welcome?.opened ?? true, pending: flag?.state !== "done",
      problem: flag?.state !== "done" ? problem : null,
      bot: bot ? { id: bot.id, name: bot.name, primary: !!bot.primary, presence: deps.bots.presenceOf(bot.id), appearance: bot.appearance ?? null } : null,
    };
  };
  return {
    bot_welcome: () => welcomeView(),
    bot_welcome_opened: () => ({ ok: markWelcomeOpened(dataDir) }),
  };
}
