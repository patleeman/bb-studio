import {
  resolveBuiltinPluginRootPath,
  type BundledPluginDefinition,
  type BundledPluginRegistration,
} from "./builtin-registry.js";

export const FORK_BUNDLED_PLUGINS: readonly BundledPluginDefinition[] = [
  {
    name: "bb-studio",
    pluginId: "studio",
    autoInstall: true,
    defaultEnabled: true,
  },
  {
    name: "bb-studio-visual-chat",
    pluginId: "studio-visual-chat",
    autoInstall: true,
    defaultEnabled: true,
  },
];

export function withForkBundledPlugins(
  registrations: readonly BundledPluginRegistration[],
  resolveRoot: (name: string) => string = resolveBuiltinPluginRootPath,
): BundledPluginRegistration[] {
  const names = new Set(registrations.map((plugin) => plugin.name));
  return [
    ...registrations,
    ...FORK_BUNDLED_PLUGINS.filter((plugin) => !names.has(plugin.name)).map(
      (plugin) => ({ ...plugin, rootDir: resolveRoot(plugin.name) }),
    ),
  ];
}
