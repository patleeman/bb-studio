import type { BbPluginApi } from "@get-bb/plugin-sdk";
type Sdk = BbPluginApi["sdk"];

/** Keep checks shared by the UI, RPC and agent tools. */
export const MAC_ONLY_RUNNER_TOOLS = ["cua", "computer use", "Beeper", "AgentMail", "osascript", "open -a", "Keychain", "iMessage"] as const;
export class RunnerPreflightError extends Error {
  constructor(readonly warnings: string[], readonly blocked: string | null) {
    super(blocked ?? `${warnings.join("\n")}\nReview these warnings and use confirm: true to proceed.`);
  }
}
export async function resolveRunnerMachine(sdk: Sdk, machine?: string | null) {
  if (!machine?.trim()) return null;
  const hosts = await sdk.hosts.list();
  const exact = hosts.find(host => host.id === machine.trim());
  if (exact) return exact;
  const names = hosts.filter(host => host.name.toLowerCase() === machine.trim().toLowerCase());
  if (names.length !== 1) throw new Error(names.length ? `Machine name "${machine}" is ambiguous; use its host id.` : `No machine "${machine}".`);
  return names[0]!;
}
export async function runnerMachineCheck(sdk: Sdk, input: { machine?: string | null; job: string; providerId: string }) {
  const host = await resolveRunnerMachine(sdk, input.machine);
  const result = { machine: host?.id ?? null, machineName: host?.name ?? null, warnings: [] as string[], blocked: null as string | null, install: false, providerName: input.providerId, signInHint: null as string | null };
  if (!host) return result;
  if (host.status !== "connected") return { ...result, blocked: `Machine offline: ${host.name}.` };
  const [cli, states, providers] = await Promise.all([
    sdk.hosts.providerCliStatus({ hostId: host.id }),
    sdk.system.providerStates({ hostId: host.id }),
    sdk.providers.list({ hostId: host.id }),
  ]);
  const status = cli[input.providerId];
  const state = states.providers.find(p => p.providerId === input.providerId);
  const provider = providers.find(p => p.id === input.providerId);
  result.providerName = provider?.displayName ?? status?.displayName ?? input.providerId;
  result.signInHint = provider?.strings?.signInHint ?? state?.loginCommand ?? state?.localLoginCommand ?? null;
  if (!status?.installed) {
    result.install = true;
    result.blocked = `Install ${result.providerName} on ${host.name}`;
  } else if (state?.status !== "ready") {
    result.blocked = `${result.providerName} needs sign-in on ${host.name}. ${result.signInHint ?? state?.statusMessage ?? "Sign in on that machine, then check again."}`;
  }
  if (result.blocked) return result;
  const paths = [...new Set([...input.job.matchAll(/(?:^|[\s\x60"'(=])((?:~\/|\/)[^\s\x60"'<>),;]+)/g)].map(match => match[1]!))];
  if (paths.length) {
    const { existence } = await sdk.hosts.pathsExist({ hostId: host.id, paths });
    for (const path of paths) if (!existence[path]) result.warnings.push(`Path does not exist on ${host.name}: ${path}`);
  }
  for (const tool of MAC_ONLY_RUNNER_TOOLS) if (input.job.toLowerCase().includes(tool.toLowerCase())) result.warnings.push(`Mac-only tool may be unavailable on ${host.name}: ${tool}`);
  return result;
}

export async function runnerEnvironment(sdk: Sdk, machine: string | null) {
  if (!machine) return { type: "project-default" as const };
  const providers = await sdk.environments.listProviders({ hostId: machine });
  const personal = providers.find(p => (p.environmentProviderId ?? p.id) === "personal-workspace" && p.acceptsEmptyInputs && (!p.availability || p.availability.status === "available") && (!p.machineAvailability[machine] || p.machineAvailability[machine]?.status === "available"));
  return personal
    ? { type: "provider" as const, environmentProviderId: personal.environmentProviderId ?? personal.id, inputs: null, machine: { type: "existing" as const, hostId: machine } }
    : { type: "host" as const, hostId: machine, workspace: { type: "unmanaged" as const, path: null } };
}
