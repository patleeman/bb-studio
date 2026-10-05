// Bots can run on an outside agent (Hermes, OpenClaw, Dot) through the
// external-agents plugin. Those providers accept fewer permission modes than
// BB's own agents, and they can't use BB's tools: they chat and do their work
// on their own side.
import type { PermissionMode, ProfileInput } from "./contract";

export interface ExternalAgent {
  name: string;
  /** Permission modes the provider accepts, the default first. */
  permissionModes: readonly PermissionMode[];
}

export const EXTERNAL_AGENTS: Readonly<Record<string, ExternalAgent>> = {
  hermes: { name: "Hermes", permissionModes: ["accept-edits", "full"] },
  openclaw: { name: "OpenClaw", permissionModes: ["accept-edits", "full"] },
  dot: { name: "Dot", permissionModes: ["full"] },
};

export function externalAgent(providerId: string | null | undefined): ExternalAgent | null {
  return providerId && Object.hasOwn(EXTERNAL_AGENTS, providerId) ? EXTERNAL_AGENTS[providerId]! : null;
}

export const isExternalProvider = (providerId: string | null | undefined) => externalAgent(providerId) !== null;

/** A permission mode the provider accepts: the requested one, or the provider's default. */
export function permissionModeFor(providerId: string | null | undefined, mode: PermissionMode): PermissionMode {
  const agent = externalAgent(providerId);
  if (!agent || agent.permissionModes.includes(mode)) return mode;
  return agent.permissionModes[0]!;
}

/** Outside agents take no reasoning level; BB's providers keep theirs. */
export function reasoningLevelFor<T extends string>(providerId: string | null | undefined, level: T): T | "none" {
  return isExternalProvider(providerId) ? "none" : level;
}

/** Fits a profile's permission mode and reasoning levels to its providers. */
export function fitProfileToProvider<T extends Pick<ProfileInput, "providerId" | "permissionMode" | "reasoningLevel" | "fallbackProviderId" | "fallbackReasoningLevel">>(profile: T): T {
  return {
    ...profile,
    permissionMode: permissionModeFor(profile.providerId, profile.permissionMode),
    reasoningLevel: reasoningLevelFor(profile.providerId, profile.reasoningLevel),
    fallbackReasoningLevel: reasoningLevelFor(profile.fallbackProviderId, profile.fallbackReasoningLevel),
  };
}

export function externalPermissionHint(providerId: string | null | undefined): string | null {
  const agent = externalAgent(providerId);
  if (!agent) return null;
  return agent.permissionModes.length === 1
    ? `${agent.name} runs only with full access.`
    : `${agent.name} runs with ${agent.permissionModes.map(m => m === "full" ? "full access" : "accept edits").join(" or ")}. Auto isn't available.`;
}

export function externalToolsNote(providerId: string | null | undefined): string | null {
  const agent = externalAgent(providerId);
  if (!agent) return null;
  return `${agent.name} is an outside agent. It chats in its BB threads and does its work on its own side. It can't use BB tools such as the bots skill or the bb CLI, and it keeps its own memory.`;
}
