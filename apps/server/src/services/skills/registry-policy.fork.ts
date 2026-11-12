import type {
  ExperimentalSkillsRegistryOperation,
  ExperimentalSkillsRegistryPolicy,
} from "@get-bb/plugin-sdk";
import type { Context, Hono, Next } from "hono";
import { ApiError } from "../../errors.js";

const POLICY_TIMEOUT_MS = 5_000;
const policies = new Map<string, ExperimentalSkillsRegistryPolicy>();

export function registerSkillsRegistryPolicy(
  pluginId: string,
  policy: ExperimentalSkillsRegistryPolicy,
): () => void {
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

async function ask(
  pluginId: string,
  policy: ExperimentalSkillsRegistryPolicy,
  operation: ExperimentalSkillsRegistryOperation,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const decision = await Promise.race([
      Promise.resolve(policy({ operation })),
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
): Promise<void> {
  for (const [pluginId, policy] of policies) {
    const refusal = await ask(pluginId, policy, operation);
    if (refusal !== null) {
      throw new ApiError(403, "skills_registry_refused", refusal);
    }
  }
}

export function registerSkillsRegistryGate(app: Hono): void {
  const gate = async (context: Context, next: Next) => {
    await checkSkillsRegistryPolicy(
      skillsRegistryOperation(context.req.method, context.req.path),
    );
    await next();
  };
  app.use("/skills-registry", gate);
  app.use("/skills-registry/*", gate);
}
