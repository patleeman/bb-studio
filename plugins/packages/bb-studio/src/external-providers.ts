// External bots' providers (Studio Agents), shared by the server and the UI.
export const EXTERNAL_PROVIDERS: readonly { id: string; displayName: string }[] = [
  { id: "hermes", displayName: "Hermes" },
  { id: "openclaw", displayName: "OpenClaw" },
  { id: "grok", displayName: "Grok" },
  { id: "dot", displayName: "Dot" },
];
export const EXTERNAL_AGENTS_PLUGIN_ID = "external-agents";

/** Why a Studio-local feature is off for an external bot: "Runs on Hermes — its memory and tools live there." */
export function externalNote(providerId: string | null | undefined): string {
  return `Runs on ${externalName(providerId)} — its memory and tools live there.`;
}

/** The provider's display name, or its id. */
export function externalName(providerId: string | null | undefined): string {
  return EXTERNAL_PROVIDERS.find((each) => each.id === providerId)?.displayName ?? providerId ?? "an external agent";
}
