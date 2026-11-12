import type { HostApproval } from "./kit/host-approval";
import type { SkillsRegistryState } from "./skills-registry-contract";

export const SKILLS_REGISTRY_KV_KEY = "skills-registry:allowed";

export type SkillsRegistryOperation = "search" | "read" | "install";
export type SkillsRegistryDecision = { allowed: true } | { allowed: false; message: string };
type Policy = (request: { operation: SkillsRegistryOperation }) => SkillsRegistryDecision | Promise<SkillsRegistryDecision>;

const OFF_MESSAGES: Record<SkillsRegistryOperation, string> = {
  install: "Installing skills from the public registry is off in BB Studio. A person can turn it on in Settings.",
  search: "Searching the public skill registry is off in BB Studio. A person can turn it on in Settings.",
  read: "Reading the public skill registry is off in BB Studio. A person can turn it on in Settings.",
};

export function registryDecision(enabled: boolean, operation: SkillsRegistryOperation): SkillsRegistryDecision {
  return enabled ? { allowed: true } : { allowed: false, message: OFF_MESSAGES[operation] ?? OFF_MESSAGES.install };
}

interface Kv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface SkillsRegistryGate {
  state(): Promise<SkillsRegistryState>;
  set(enabled: boolean): Promise<SkillsRegistryState>;
  decide(operation: SkillsRegistryOperation): Promise<SkillsRegistryDecision>;
}

export function createSkillsRegistryGate(deps: { hooks: object | undefined; kv: Kv; approval: HostApproval | null; changed?(): void }): SkillsRegistryGate {
  let pending = false;
  let error: string | null = null;
  const enabled = async () => (await deps.kv.get<boolean>(SKILLS_REGISTRY_KV_KEY)) === true;
  const decide = async (operation: SkillsRegistryOperation) => registryDecision(await enabled(), operation);
  const register = deps.hooks ? Object.entries(deps.hooks).find(([key]) => key === "experimental_skillsRegistryPolicy")?.[1] : undefined;
  const gated = typeof register === "function";
  if (gated) (register as (policy: Policy) => void).call(deps.hooks, ({ operation }) => decide(operation));
  const state = async (): Promise<SkillsRegistryState> => ({ enabled: await enabled(), pending, gated, error });
  return {
    state,
    decide,
    async set(next) {
      error = null;
      if (!next) {
        await deps.kv.set(SKILLS_REGISTRY_KV_KEY, false);
        deps.changed?.();
        return state();
      }
      if (await enabled()) return state();
      if (!deps.approval) {
        error = "Turning the registry on needs BB Studio's approval dialog.";
        return state();
      }
      if (pending) return state();
      pending = true;
      void deps.approval({
        title: "Turn on the public skill registry?",
        message: "Agents and the bb CLI can then search skills.sh and install skills from it into BB's user skills.",
        confirmLabel: "Turn on",
      }).then(async (decision) => {
        if (decision.approved) await deps.kv.set(SKILLS_REGISTRY_KV_KEY, true);
      }).catch((cause: unknown) => {
        error = cause instanceof Error ? cause.message : String(cause);
      }).finally(() => {
        pending = false;
        deps.changed?.();
      });
      return state();
    },
  };
}
