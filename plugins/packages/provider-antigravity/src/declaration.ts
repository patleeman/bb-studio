import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";

export const ANTIGRAVITY_PLUGIN_ID = "provider-antigravity";
export const ANTIGRAVITY_PROVIDER_ID = "antigravity";
export const ANTIGRAVITY_DIALECT_ID = "antigravity";

const USER_SKILL_ROOTS = [
  { path: ".gemini/antigravity-cli/skills" },
  { path: ".gemini/skills" },
  { path: ".agents/skills" },
] as const;

const PROJECT_SKILL_ROOTS = [
  { path: ".gemini/skills", ancestors: true },
  { path: ".agents/skills", ancestors: true },
] as const;

export function antigravityProviderDeclaration(): PluginProviderDeclaration {
  return {
    id: ANTIGRAVITY_PROVIDER_ID,
    displayName: "Google Antigravity",
    family: "acp",
    icon: `${ANTIGRAVITY_PLUGIN_ID}/antigravity`,
    strings: {
      signInHint: "Run `agy acp --login` on the machine to sign in.",
      expiredHint:
        "Your Google Antigravity session expired. Run `agy acp --login`, then reload.",
      installUrl: "https://antigravity.google/docs/install",
    },
    serviceTiers: [{ id: "default", label: "Default" }],
    experimental_visibility: "installed",
    experimental_nativeSkillRoots: {
      user: [...USER_SKILL_ROOTS],
      project: [...PROJECT_SKILL_ROOTS],
    },
    experimental_bridgeOptions: {
      acpDialect: ANTIGRAVITY_DIALECT_ID,
      acpLaunchSpec: {
        displayName: "Google Antigravity",
        command: "agy",
        args: ["acp"],
        env: {},
        nativeSkillRoots: {
          user: [...USER_SKILL_ROOTS],
          project: [...PROJECT_SKILL_ROOTS],
        },
      },
    },
    models: { scope: "host" },
    maintenance: {
      health: true,
      usage: true,
      installation: true,
    },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      fork: "none",
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    composerActions: [],
  };
}
