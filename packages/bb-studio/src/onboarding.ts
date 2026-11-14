import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STARTER_BOT, STARTER_PROVIDER_ORDER, starterFirstChatPrompt } from "./starter-bot";

export const ONBOARDING_FILE = join("plugins", "studio", "onboarding.json");

export type OnboardingReason = "ran" | "bots" | "import" | "threads" | "unsupported";

export interface OnboardingDone {
  version: 1;
  state: "done";
  reason: OnboardingReason;
  at: number;
  botId: string | null;
  welcomeThreadId: string | null;
  opened: boolean;
}

export interface OnboardingWaiting {
  version: 1;
  state: "waiting";
  at: number;
}

export interface OnboardingSeeded {
  version: 1;
  state: "seeded";
  at: number;
  botId: string;
  welcomeThreadId: string;
  opened: boolean;
}

export type OnboardingFlag = OnboardingDone | OnboardingWaiting | OnboardingSeeded;

export interface OnboardingProviderState {
  providerId: string;
  status: string;
  loginCommand?: string | null;
}

interface UiPreference {
  value: unknown;
  revision: number;
}

export interface OnboardingSdk {
  system?: {
    uiPreferences?: {
      list(): Promise<{ preferences: Record<string, UiPreference | undefined> }>;
      set(input: { key: string; value: unknown; expectedRevision: number }): Promise<unknown>;
    };
  };
}

export interface OnboardingDeps {
  dataDir: string;
  db: Database.Database;
  sdk: OnboardingSdk;
  providers(): Promise<readonly OnboardingProviderState[]>;
  seedBot(input: { name: string; avatar: string }): Promise<{ id: string; threadId: string }>;
  /** After the starter Bot is made: what a new install turns on with its first Bot. */
  firstBot?(): Promise<unknown>;
  startFirstChat(input: { botId: string; providerId: string; prompt: string }): Promise<string | null>;
  idleThreads?: boolean;
  now?(): number;
}

export function idleThreadRefused(error: unknown): boolean {
  return /input must contain at least one entry/i.test(error instanceof Error ? error.message : String(error));
}

const flagPath = (dataDir: string) => join(dataDir, ONBOARDING_FILE);

export const THREAD_LIST_KEY = "sidebar.threadListProvider";
export const BOT_SIDEBAR_LIST = "studio/everything";

export async function showBotSidebar(sdk: OnboardingSdk): Promise<boolean> {
  const preferences = sdk.system?.uiPreferences;
  if (!preferences) return false;
  const current = (await preferences.list()).preferences[THREAD_LIST_KEY];
  if (!current || current.value !== "__automatic__") return false;
  await preferences.set({ key: THREAD_LIST_KEY, value: BOT_SIDEBAR_LIST, expectedRevision: current.revision });
  return true;
}

/** Whether onboarding ran on this data dir: a new install, not one from before it or an import. */
export function freshInstall(flag: OnboardingFlag | null): boolean {
  return !!flag && (flag.state !== "done" || flag.reason === "ran");
}

/** Whether a Bot made now is a new install's first: no Bot yet, on a data dir onboarding ran on. */
export function firstBotOfFreshInstall(botCount: number, flag: OnboardingFlag | null): boolean {
  return botCount === 0 && freshInstall(flag);
}

export function readFlag(dataDir: string): OnboardingFlag | null {
  try {
    const value = JSON.parse(readFileSync(flagPath(dataDir), "utf8")) as Partial<OnboardingFlag>;
    return value.version === 1 && (value.state === "done" || value.state === "waiting" || value.state === "seeded") ? value as OnboardingFlag : null;
  } catch {
    return null;
  }
}

export function readOnboarding(dataDir: string): OnboardingDone | null {
  const flag = readFlag(dataDir);
  return flag?.state === "done" ? flag : null;
}

export function writeOnboarding(dataDir: string, flag: OnboardingFlag): void {
  const path = flagPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(flag, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

function hasThreads(dataDir: string): boolean {
  const path = join(dataDir, "bb.db");
  if (!existsSync(path)) return false;
  let bb: Database.Database | null = null;
  try {
    bb = new Database(path, { readonly: true, fileMustExist: true });
    bb.pragma("busy_timeout = 1000");
    return !!bb.prepare("SELECT 1 FROM threads LIMIT 1").get();
  } catch {
    return true;
  } finally {
    bb?.close();
  }
}

export function existingData(dataDir: string, db: Database.Database): Exclude<OnboardingReason, "ran"> | null {
  if (db.prepare("SELECT 1 FROM bots LIMIT 1").get()) return "bots";
  if (existsSync(join(dataDir, "fork-import.json")) || existsSync(join(dataDir, "fork-import.db"))) return "import";
  if (hasThreads(dataDir)) return "threads";
  return null;
}

export function decideOnboarding(dataDir: string, db: Database.Database, now = Date.now()): OnboardingFlag {
  const before = readFlag(dataDir);
  if (before) return before;
  const existing = existingData(dataDir, db);
  const flag: OnboardingFlag = existing
    ? { version: 1, state: "done", reason: existing, at: now, botId: null, welcomeThreadId: null, opened: true }
    : { version: 1, state: "waiting", at: now };
  writeOnboarding(dataDir, flag);
  return flag;
}

export function readyProvider(states: readonly OnboardingProviderState[]): string | null {
  const ready = states.filter((state) => state.status === "ready" && !!state.loginCommand).map((state) => state.providerId);
  return STARTER_PROVIDER_ORDER.find((id) => ready.includes(id)) ?? ready[0] ?? null;
}

const running = new WeakMap<Database.Database, Promise<OnboardingFlag>>();

export function runOnboarding(deps: OnboardingDeps): Promise<OnboardingFlag> {
  const current = running.get(deps.db);
  if (current) return current;
  const next = onboard(deps).finally(() => running.delete(deps.db));
  running.set(deps.db, next);
  return next;
}

async function onboard(deps: OnboardingDeps): Promise<OnboardingFlag> {
  const now = (deps.now ?? Date.now)();
  let flag = decideOnboarding(deps.dataDir, deps.db, now);
  if (flag.state === "done" || !deps.db.open) return flag;
  if (flag.state === "waiting") {
    const finish = (reason: Exclude<OnboardingReason, "ran">): OnboardingDone => {
      const done: OnboardingDone = { version: 1, state: "done", reason, at: now, botId: null, welcomeThreadId: null, opened: true };
      writeOnboarding(deps.dataDir, done);
      return done;
    };
    const existing = existingData(deps.dataDir, deps.db);
    if (existing) return finish(existing);
    if (deps.idleThreads === false) return finish("unsupported");
    let bot: { id: string; threadId: string };
    try {
      bot = await deps.seedBot({ name: STARTER_BOT.name, avatar: STARTER_BOT.avatar });
    } catch (error) {
      if (idleThreadRefused(error)) return finish("unsupported");
      throw error;
    }
    await deps.firstBot?.().catch(() => undefined);
    await showBotSidebar(deps.sdk).catch(() => false);
    flag = { version: 1, state: "seeded", at: now, botId: bot.id, welcomeThreadId: bot.threadId, opened: false };
    writeOnboarding(deps.dataDir, flag);
  }
  const providerId = readyProvider(await deps.providers());
  if (!providerId || !deps.db.open) return flag;
  const threadId = await deps.startFirstChat({ botId: flag.botId, providerId, prompt: starterFirstChatPrompt(STARTER_BOT.name) });
  const welcomeThreadId = threadId ?? flag.welcomeThreadId;
  const latest = readFlag(deps.dataDir);
  const opened = welcomeThreadId === flag.welcomeThreadId && (flag.opened || (latest?.state !== "waiting" && latest?.welcomeThreadId === welcomeThreadId && !!latest.opened));
  const done: OnboardingDone = { version: 1, state: "done", reason: "ran", at: now, botId: flag.botId, welcomeThreadId, opened };
  writeOnboarding(deps.dataDir, done);
  return done;
}

export function welcomeThreadOf(dataDir: string): { threadId: string; botId: string; opened: boolean } | null {
  const flag = readFlag(dataDir);
  if (flag?.state === "seeded") return { threadId: flag.welcomeThreadId, botId: flag.botId, opened: flag.opened };
  return flag?.state === "done" && flag.reason === "ran" && flag.welcomeThreadId && flag.botId ? { threadId: flag.welcomeThreadId, botId: flag.botId, opened: flag.opened } : null;
}

export function markWelcomeOpened(dataDir: string): boolean {
  const flag = readFlag(dataDir);
  if (!flag || flag.state === "waiting" || flag.opened) return false;
  writeOnboarding(dataDir, { ...flag, opened: true });
  return true;
}
