import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BOT_ID } from "./bot";
import { PERSONAL_PROJECT_ID } from "./project-lead";
import { WELCOME_BOT_NAME, WELCOME_TITLE } from "./onboarding-message";

export const ONBOARDING_FILE = join("plugins", "studio", "onboarding.json");
const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60_000;
export const NO_PROVIDER_MODEL = { providerId: "claude-code", model: "default" } as const;
const WAIT_CODES = new Set(["host_unavailable", "host_not_ready", "host_offline"]);
const NO_MODEL_CODES = new Set(["model_catalog_unavailable", "model_required"]);

function errorCode(error: unknown): string | null {
  const value = error as { code?: unknown; body?: { code?: unknown } } | null;
  const code = value?.code ?? value?.body?.code;
  if (typeof code === "string") return code;
  const message = error instanceof Error ? error.message : String(error);
  if (/host is not connected/i.test(message)) return "host_unavailable";
  if (/unable to load .* models to resolve the default|pick a model/i.test(message)) return "model_catalog_unavailable";
  return null;
}

export type OnboardingReason = "ran" | "bots" | "import" | "threads";

export interface OnboardingFlag {
  version: 1;
  state: "done";
  reason: OnboardingReason;
  at: number;
  botId: string | null;
  welcomeThreadId: string | null;
  opened: boolean;
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
  threads: {
    spawn(args: Record<string, unknown>): Promise<{ id: string }>;
    queuedMessages: {
      list(args: { threadId: string }): Promise<readonly { id: string }[]>;
      delete(args: { threadId: string; queuedMessageId: string }): Promise<unknown>;
    };
  };
}

export interface OnboardingDeps {
  dataDir: string;
  db: Database.Database;
  sdk: OnboardingSdk;
  createBot(input: { name: string; avatar: string; threadId: string }): Promise<{ id: string }>;
  recordConversation(threadId: string, botId: string): void;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  waitMs?: number;
  attempts?: number;
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

export function readOnboarding(dataDir: string): OnboardingFlag | null {
  try {
    const value = JSON.parse(readFileSync(flagPath(dataDir), "utf8")) as Partial<OnboardingFlag>;
    return value.version === 1 && value.state === "done" ? value as OnboardingFlag : null;
  } catch {
    return null;
  }
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

async function spawnWhenReady(deps: OnboardingDeps, args: Record<string, unknown>): Promise<{ id: string }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = deps.attempts ?? 120;
  let model: Record<string, unknown> = {};
  for (let attempt = 1; ; attempt++) {
    if (!deps.db.open) throw new Error("Studio stopped before onboarding finished.");
    try {
      return await deps.sdk.threads.spawn({ ...args, ...model });
    } catch (error) {
      const code = errorCode(error);
      if (code && NO_MODEL_CODES.has(code) && !("model" in model)) {
        model = { ...NO_PROVIDER_MODEL };
        continue;
      }
      if (!code || !WAIT_CODES.has(code) || attempt >= attempts) throw error;
      await sleep(deps.waitMs ?? 5_000);
    }
  }
}

async function turnlessThread(deps: OnboardingDeps, title: string, pluginMetadata: Record<string, string>, now: number): Promise<string> {
  const thread = await spawnWhenReady(deps, {
    projectId: PERSONAL_PROJECT_ID,
    title,
    environment: { type: "project-default" },
    pluginMetadata,
    input: [{ type: "text", text: title, mentions: [] }],
    sendAt: now + FAR_FUTURE_MS,
  });
  for (const row of await deps.sdk.threads.queuedMessages.list({ threadId: thread.id })) {
    await deps.sdk.threads.queuedMessages.delete({ threadId: thread.id, queuedMessageId: row.id });
  }
  return thread.id;
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
  const before = readOnboarding(deps.dataDir);
  if (before) return before;
  const existing = existingData(deps.dataDir, deps.db);
  if (existing) {
    const flag: OnboardingFlag = { version: 1, state: "done", reason: existing, at: now, botId: null, welcomeThreadId: null, opened: true };
    writeOnboarding(deps.dataDir, flag);
    return flag;
  }
  const mainId = await turnlessThread(deps, WELCOME_BOT_NAME, { bot: BOT_ID }, now);
  const bot = await deps.createBot({ name: WELCOME_BOT_NAME, avatar: "🤖", threadId: mainId });
  const welcomeId = await turnlessThread(deps, WELCOME_TITLE, { botConversation: bot.id }, now);
  deps.recordConversation(welcomeId, bot.id);
  await showBotSidebar(deps.sdk).catch(() => false);
  const flag: OnboardingFlag = { version: 1, state: "done", reason: "ran", at: now, botId: bot.id, welcomeThreadId: welcomeId, opened: false };
  writeOnboarding(deps.dataDir, flag);
  return flag;
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
