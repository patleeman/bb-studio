import {
  getInstalledPlugin,
  pluginKv,
  setPluginKvValue,
  type DbConnection,
} from "@bb/db";
import {
  CALLER_THREAD_HEADER_NAME,
  CLI_REQUEST_HEADER_NAME,
} from "@bb/config/app-surface";
import type {
  ExperimentalSkillsRegistryCaller,
  ExperimentalSkillsRegistryOperation,
  ExperimentalSkillsRegistryPolicy,
} from "@get-bb/plugin-sdk";
import { eq } from "drizzle-orm";
import type { Context, Hono, Next } from "hono";
import { ApiError } from "../../errors.js";

const POLICY_TIMEOUT_MS = 5_000;
export const SKILLS_REGISTRY_POLICY_OWNER_KEY = "bb.fork.skillsRegistryPolicy";
const policies = new Map<string, ExperimentalSkillsRegistryPolicy>();

export function registerSkillsRegistryPolicy(
  pluginId: string,
  policy: ExperimentalSkillsRegistryPolicy,
  db?: DbConnection,
): () => void {
  if (db !== undefined) {
    setPluginKvValue(db, pluginId, SKILLS_REGISTRY_POLICY_OWNER_KEY, "1");
  }
  policies.set(pluginId, policy);
  return () => {
    if (policies.get(pluginId) === policy) policies.delete(pluginId);
  };
}

export function skillsRegistryOperation(
  method: string,
  path: string,
): ExperimentalSkillsRegistryOperation {
  if (/\/skills-registry\/install(?:-jobs)?(?:\/|$)/.test(path)) {
    return "install";
  }
  if (method === "GET" && /\/skills-registry\/?$/.test(path)) return "search";
  return "read";
}

export function skillsRegistryCaller(
  header: (name: string) => string | undefined,
): ExperimentalSkillsRegistryCaller {
  const threadId = header(CALLER_THREAD_HEADER_NAME)?.trim();
  if (threadId) return { kind: "agent", threadId };
  return header(CLI_REQUEST_HEADER_NAME) === undefined
    ? { kind: "app" }
    : { kind: "cli" };
}

function ownersNotLoaded(db: DbConnection | null): string[] {
  if (db === null) return [];
  return db
    .select({ pluginId: pluginKv.pluginId })
    .from(pluginKv)
    .where(eq(pluginKv.key, SKILLS_REGISTRY_POLICY_OWNER_KEY))
    .all()
    .map((row) => row.pluginId)
    .filter((pluginId) => {
      if (policies.has(pluginId)) return false;
      const plugin = getInstalledPlugin(db, pluginId);
      return (
        plugin !== undefined && plugin.enabled && plugin.removedAt === null
      );
    });
}

async function ask(
  pluginId: string,
  policy: ExperimentalSkillsRegistryPolicy,
  operation: ExperimentalSkillsRegistryOperation,
  caller: ExperimentalSkillsRegistryCaller,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const decision = await Promise.race([
      Promise.resolve(policy({ operation, caller })),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${pluginId} did not answer in time`)),
          POLICY_TIMEOUT_MS,
        );
      }),
    ]);
    if (decision?.allowed === true) return null;
    return typeof decision?.message === "string" && decision.message !== ""
      ? decision.message
      : `The ${pluginId} plugin refused this skill registry request.`;
  } catch (error) {
    return `The ${pluginId} plugin refused this skill registry request: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkSkillsRegistryPolicy(
  operation: ExperimentalSkillsRegistryOperation,
  caller: ExperimentalSkillsRegistryCaller = { kind: "app" },
  db: DbConnection | null = null,
): Promise<void> {
  const absent = ownersNotLoaded(db)[0];
  if (absent !== undefined) {
    throw new ApiError(
      403,
      "skills_registry_refused",
      `The ${absent} plugin decides skill registry requests and is not running. Try again once it has started.`,
    );
  }
  for (const [pluginId, policy] of policies) {
    const refusal = await ask(pluginId, policy, operation, caller);
    if (refusal !== null) {
      throw new ApiError(403, "skills_registry_refused", refusal);
    }
  }
}

export function registerSkillsRegistryGate(
  app: Hono,
  db: DbConnection | null = null,
): void {
  const gate = async (context: Context, next: Next) => {
    await checkSkillsRegistryPolicy(
      skillsRegistryOperation(context.req.method, context.req.path),
      skillsRegistryCaller((name) => context.req.header(name)),
      db,
    );
    await next();
  };
  app.use("/skills-registry", gate);
  app.use("/skills-registry/*", gate);
}
