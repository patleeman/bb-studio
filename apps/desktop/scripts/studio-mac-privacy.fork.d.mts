export const UPSTREAM_MAC_ENTITLEMENTS: "build/entitlements.mac.plist";
export const STUDIO_MAC_ENTITLEMENTS: "build/entitlements.mac.fork.plist";
export const STUDIO_MAC_USAGE: Record<
  | "NSCalendarsFullAccessUsageDescription"
  | "NSCalendarsUsageDescription"
  | "NSRemindersFullAccessUsageDescription"
  | "NSRemindersUsageDescription",
  string
>;
export const STUDIO_MAC_ADDED_ENTITLEMENTS: string[];

export function plistTrueKeys(text: string): string[];
export function readDesktopFile(path: string): string;
export function expectedStudioMacEntitlements(upstreamText: string): string[];
export function studioMacEntitlementProblems(
  upstreamText: string,
  forkText: string,
): string[];
export function studioMacAppProblems(args: {
  info: Record<string, unknown>;
  entitlements: string[];
  upstreamText: string;
}): string[];
export function applyStudioMacPrivacy<T extends Record<string, unknown>>(
  config: T,
): T & {
  mac: Record<string, unknown> & {
    entitlements: string;
    extendInfo: Record<string, unknown>;
  };
};
