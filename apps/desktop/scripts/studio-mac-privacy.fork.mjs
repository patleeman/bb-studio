import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const UPSTREAM_MAC_ENTITLEMENTS = "build/entitlements.mac.plist";
export const STUDIO_MAC_ENTITLEMENTS = "build/entitlements.mac.fork.plist";

const REMINDERS =
  "BB Studio lets agents you run read and update your reminders when you ask them to.";
const CALENDARS =
  "BB Studio lets agents you run read and update your calendars when you ask them to.";

export const STUDIO_MAC_USAGE = {
  NSCalendarsFullAccessUsageDescription: CALENDARS,
  NSCalendarsUsageDescription: CALENDARS,
  NSRemindersFullAccessUsageDescription: REMINDERS,
  NSRemindersUsageDescription: REMINDERS,
};

export const STUDIO_MAC_ADDED_ENTITLEMENTS = [
  "com.apple.security.personal-information.calendars",
];

export function plistTrueKeys(text) {
  const keys = [];
  for (const match of text.matchAll(
    /<key>([^<]+)<\/key>\s*<(true|false)\s*\/>/g,
  )) {
    if (match[2] === "true") keys.push(match[1]);
  }
  return keys.sort();
}

export function readDesktopFile(path) {
  return readFileSync(resolve(desktopRoot, path), "utf8");
}

export function expectedStudioMacEntitlements(upstreamText) {
  return [
    ...new Set([
      ...plistTrueKeys(upstreamText),
      ...STUDIO_MAC_ADDED_ENTITLEMENTS,
    ]),
  ].sort();
}

export function studioMacEntitlementProblems(upstreamText, forkText) {
  const expected = expectedStudioMacEntitlements(upstreamText);
  const actual = plistTrueKeys(forkText);
  const problems = [];
  for (const key of expected) {
    if (!actual.includes(key)) {
      problems.push(`${STUDIO_MAC_ENTITLEMENTS} lacks ${key}`);
    }
  }
  for (const key of actual) {
    if (!expected.includes(key)) {
      problems.push(
        `${STUDIO_MAC_ENTITLEMENTS} has ${key}, which is neither in ${UPSTREAM_MAC_ENTITLEMENTS} nor added by Studio`,
      );
    }
  }
  return problems;
}

export function studioMacAppProblems({ info, entitlements, upstreamText }) {
  const problems = [];
  for (const [key, text] of Object.entries(STUDIO_MAC_USAGE)) {
    if (info[key] !== text) problems.push(`Info.plist ${key} is not set`);
  }
  const signed = new Set(entitlements);
  for (const key of expectedStudioMacEntitlements(upstreamText)) {
    if (!signed.has(key)) problems.push(`the app is not signed with ${key}`);
  }
  return problems;
}

export function applyStudioMacPrivacy(config) {
  const problems = studioMacEntitlementProblems(
    readDesktopFile(UPSTREAM_MAC_ENTITLEMENTS),
    readDesktopFile(STUDIO_MAC_ENTITLEMENTS),
  );
  if (problems.length > 0) {
    throw new Error(
      `${problems.join("; ")}: ${STUDIO_MAC_ENTITLEMENTS} must be ${UPSTREAM_MAC_ENTITLEMENTS} plus ${STUDIO_MAC_ADDED_ENTITLEMENTS.join(", ")}`,
    );
  }
  config.mac = {
    ...config.mac,
    entitlements: STUDIO_MAC_ENTITLEMENTS,
    extendInfo: { ...config.mac?.extendInfo, ...STUDIO_MAC_USAGE },
  };
  return config;
}
