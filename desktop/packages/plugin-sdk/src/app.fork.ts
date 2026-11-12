import type { ForkPluginSdkApp } from "./app-contract.fork.js";

interface ForkRuntimeHost {
  __bbPluginRuntime?: {
    pluginSdkApp?: unknown;
  };
}

type ForkFunctionName = {
  [Name in keyof ForkPluginSdkApp]: ForkPluginSdkApp[Name] extends (
    ...args: never[]
  ) => unknown
    ? Name
    : never;
}[keyof ForkPluginSdkApp];

function runtimeHost(): ForkRuntimeHost["__bbPluginRuntime"] {
  return (globalThis as ForkRuntimeHost).__bbPluginRuntime;
}

function runtimeMember<Name extends keyof ForkPluginSdkApp>(
  name: Name,
): ForkPluginSdkApp[Name] {
  const app = runtimeHost()?.pluginSdkApp as
    | Partial<ForkPluginSdkApp>
    | undefined;
  const member = app?.[name];
  if (member === undefined) {
    throw new Error(
      `@get-bb/plugin-sdk/app: ${name} needs the bb app's plugin runtime. In tests, call installTestPluginRuntime() from @get-bb/plugin-sdk/testing/app first.`,
    );
  }
  return member as ForkPluginSdkApp[Name];
}

function runtimeFunction<Name extends ForkFunctionName>(
  name: Name,
): ForkPluginSdkApp[Name] {
  const forward = (...args: unknown[]) =>
    (runtimeMember(name) as (...args: unknown[]) => unknown)(...args);
  return forward as ForkPluginSdkApp[Name];
}

export const experimental_useAppRoute = runtimeFunction(
  "experimental_useAppRoute",
);
export const experimental_useSidebarNewItems = runtimeFunction(
  "experimental_useSidebarNewItems",
);
export const experimental_useGlobalTabs = runtimeFunction(
  "experimental_useGlobalTabs",
);
export const experimental_useAppTheme = runtimeFunction(
  "experimental_useAppTheme",
);
export const experimental_useAppPanes = runtimeFunction(
  "experimental_useAppPanes",
);
export const experimental_useLauncherItems = runtimeFunction(
  "experimental_useLauncherItems",
);
export const experimental_writeDragItem = runtimeFunction(
  "experimental_writeDragItem",
);
export const experimental_readDragItem = runtimeFunction(
  "experimental_readDragItem",
);
export const experimental_useContextCard = runtimeFunction(
  "experimental_useContextCard",
);
export const experimental_useWindows = runtimeFunction(
  "experimental_useWindows",
);
export const experimental_useAppCommands = runtimeFunction(
  "experimental_useAppCommands",
);
export const experimental_useTabWindow = runtimeFunction(
  "experimental_useTabWindow",
);
