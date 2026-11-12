import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ONBOARDING_BOT_NAME, ONBOARDING_PROVIDER_ORDER, onboardingPrompt } from "./onboarding-prompt";

export const ONBOARDING_FILE = join("plugins", "studio", "onboarding.json");

export type OnboardingReason = "ran" | "bots" | "import" | "threads";

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

export type OnboardingFlag = OnboardingDone | OnboardingWaiting;

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
  createBot(input: { name: string; avatar: string; providerId: string; prompt: string }): Promise<{ id: string; threadId: string | null }>;
  now?(): number;
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

export function readFlag(dataDir: string): OnboardingFlag | null {
  try {
    const value = JSON.parse(readFileSync(flagPath(dataDir), "utf8")) as Partial<OnboardingFlag>;
    return value.version === 1 && (value.state === "done" || value.state === "waiting") ? value as OnboardingFlag : null;
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
  return ONBOARDING_PROVIDER_ORDER.find((id) => ready.includes(id)) ?? ready[0] ?? null;
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
  const flag = decideOnboarding(deps.dataDir, deps.db, now);
  if (flag.state === "done") return flag;
  const providerId = readyProvider(await deps.providers());
  if (!providerId || !deps.db.open) return flag;
  const bot = await deps.createBot({ name: ONBOARDING_BOT_NAME, avatar: "🤖", providerId, prompt: onboardingPrompt(ONBOARDING_BOT_NAME) });
  await showBotSidebar(deps.sdk).catch(() => false);
  const done: OnboardingDone = { version: 1, state: "done", reason: "ran", at: now, botId: bot.id, welcomeThreadId: bot.threadId, opened: false };
  writeOnboarding(deps.dataDir, done);
  return done;
}

export function welcomeThreadOf(dataDir: string): { threadId: string; botId: string; opened: boolean } | null {
  const flag = readOnboarding(dataDir);
  return flag?.reason === "ran" && flag.welcomeThreadId && flag.botId ? { threadId: flag.welcomeThreadId, botId: flag.botId, opened: flag.opened } : null;
}

export function markWelcomeOpened(dataDir: string): boolean {
  const flag = readOnboarding(dataDir);
  if (!flag || flag.opened) return false;
  writeOnboarding(dataDir, { ...flag, opened: true });
  return true;
}
