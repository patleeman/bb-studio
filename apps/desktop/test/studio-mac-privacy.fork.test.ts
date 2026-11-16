import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyStudioMacPrivacy,
  expectedStudioMacEntitlements,
  plistTrueKeys,
  readDesktopFile,
  STUDIO_MAC_ENTITLEMENTS,
  STUDIO_MAC_USAGE,
  studioMacAppProblems,
  studioMacEntitlementProblems,
  UPSTREAM_MAC_ENTITLEMENTS,
} from "../scripts/studio-mac-privacy.fork.mjs";

const upstreamText = readDesktopFile(UPSTREAM_MAC_ENTITLEMENTS);
const forkText = readDesktopFile(STUDIO_MAC_ENTITLEMENTS);
const baseConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "electron-builder.config.json"), "utf8"),
) as { mac: Record<string, unknown> & { extendInfo: Record<string, string> } };

describe("Studio macOS privacy", () => {
  it("adds the Reminders and Calendars usage texts to the app's Info.plist", () => {
    const config = applyStudioMacPrivacy(structuredClone(baseConfig));
    expect(Object.keys(STUDIO_MAC_USAGE).sort()).toEqual([
      "NSCalendarsFullAccessUsageDescription",
      "NSCalendarsUsageDescription",
      "NSRemindersFullAccessUsageDescription",
      "NSRemindersUsageDescription",
    ]);
    for (const [key, text] of Object.entries(STUDIO_MAC_USAGE)) {
      expect(config.mac.extendInfo[key]).toBe(text);
      expect(text).toMatch(/^BB Studio lets agents you run /);
    }
    for (const [key, text] of Object.entries(baseConfig.mac.extendInfo)) {
      expect(config.mac.extendInfo[key]).toBe(text);
    }
  });

  it("signs the app with upstream's entitlements plus Calendars", () => {
    const config = applyStudioMacPrivacy(structuredClone(baseConfig));
    expect(config.mac.entitlements).toBe(STUDIO_MAC_ENTITLEMENTS);
    expect(config.mac.entitlementsInherit).toBe(
      baseConfig.mac.entitlementsInherit,
    );
    expect(studioMacEntitlementProblems(upstreamText, forkText)).toEqual([]);
    expect(plistTrueKeys(forkText)).toContain(
      "com.apple.security.personal-information.calendars",
    );
  });

  it("fails when upstream adds an entitlement the fork file lacks", () => {
    const added = upstreamText.replace(
      "</dict>",
      "  <key>com.apple.security.device.camera</key>\n    <true/>\n  </dict>",
    );
    expect(studioMacEntitlementProblems(added, forkText)).toEqual([
      `${STUDIO_MAC_ENTITLEMENTS} lacks com.apple.security.device.camera`,
    ]);
  });

  it("checks a built app's Info.plist and signed entitlements", () => {
    const entitlements = expectedStudioMacEntitlements(upstreamText);
    expect(
      studioMacAppProblems({
        info: { ...STUDIO_MAC_USAGE },
        entitlements,
        upstreamText,
      }),
    ).toEqual([]);
    expect(
      studioMacAppProblems({
        info: { NSMicrophoneUsageDescription: "x" },
        entitlements: entitlements.filter((key) => !key.includes("calendars")),
        upstreamText,
      }),
    ).toEqual([
      "Info.plist NSCalendarsFullAccessUsageDescription is not set",
      "Info.plist NSCalendarsUsageDescription is not set",
      "Info.plist NSRemindersFullAccessUsageDescription is not set",
      "Info.plist NSRemindersUsageDescription is not set",
      "the app is not signed with com.apple.security.personal-information.calendars",
    ]);
  });
});
