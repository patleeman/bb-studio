import { describe, expect, it } from "vitest";
import { buildInfo, bugReportUrl, osName } from "./report-bug";

describe("report a bug", () => {
  it("prefills BB Studio's issue form with the version, the bb base and the OS, and nothing else", () => {
    const info = buildInfo({ version: "1.0.1", experimental_studioBuild: { version: "1.0.1", upstreamVersion: "0.49.0", upstreamCommit: "7794941da1b6e2baf017e5f7ab65b5f223fcaf54" } }, "macOS 26.0.1 arm");
    expect(info).toEqual({ version: "1.0.1", base: "bb 0.49.0 @ 7794941", os: "macOS 26.0.1 arm" });
    const url = new URL(bugReportUrl(info));
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/patleeman/bb-studio/issues/new");
    expect([...url.searchParams.keys()]).toEqual(["template", "version", "base", "os"]);
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("base")).toBe("bb 0.49.0 @ 7794941");
  });

  it("says unknown outside the desktop app", () => {
    expect(buildInfo(null, "MacIntel")).toEqual({ version: "unknown", base: "unknown", os: "MacIntel" });
    expect(buildInfo({ version: "0.49.0" }, "x").version).toBe("0.49.0");
  });

  it("reads the OS version from the browser's client hints, else its platform", async () => {
    await expect(osName({ platform: "MacIntel", userAgentData: { getHighEntropyValues: async () => ({ platform: "macOS", platformVersion: "26.0.1", architecture: "arm" }) } })).resolves.toBe("macOS 26.0.1 arm");
    await expect(osName({ platform: "MacIntel", userAgentData: { getHighEntropyValues: async () => { throw new Error("no"); } } })).resolves.toBe("MacIntel");
    await expect(osName({ platform: "MacIntel" })).resolves.toBe("MacIntel");
    await expect(osName(undefined)).resolves.toBe("unknown");
  });
});
