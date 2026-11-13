export const BUG_REPORT_URL = "https://github.com/patleeman/bb-studio/issues/new";
export const BUG_REPORT_TEMPLATE = "bug_report.yml";
export const REPORT_BUG_FOOTER_ID = "report-bug";

export interface BugReportInfo {
  version: string;
  base: string;
  os: string;
}

interface StudioBuild {
  version: string;
  upstreamVersion: string;
  upstreamCommit: string;
}

export interface DesktopBridge {
  version?: string;
  experimental_studioBuild?: StudioBuild | null;
  openExternalUrl?(url: string): void;
}

interface HighEntropyValues {
  platform?: string;
  platformVersion?: string;
  architecture?: string;
}

export interface NavigatorLike {
  platform?: string;
  userAgentData?: { getHighEntropyValues?(hints: string[]): Promise<HighEntropyValues> };
}

export function bugReportUrl(info: BugReportInfo): string {
  const url = new URL(BUG_REPORT_URL);
  url.searchParams.set("template", BUG_REPORT_TEMPLATE);
  url.searchParams.set("version", info.version);
  url.searchParams.set("base", info.base);
  url.searchParams.set("os", info.os);
  return url.toString();
}

export function buildInfo(bridge: DesktopBridge | null, os: string): BugReportInfo {
  const build = bridge?.experimental_studioBuild ?? null;
  return {
    version: build?.version ?? bridge?.version ?? "unknown",
    base: build ? `bb ${build.upstreamVersion} @ ${build.upstreamCommit.slice(0, 7)}` : "unknown",
    os,
  };
}

export async function osName(nav: NavigatorLike | undefined): Promise<string> {
  try {
    const values = await nav?.userAgentData?.getHighEntropyValues?.(["platformVersion", "architecture"]);
    if (values?.platform) return [values.platform, values.platformVersion, values.architecture].filter(Boolean).join(" ");
  } catch {
    return nav?.platform || "unknown";
  }
  return nav?.platform || "unknown";
}

function desktopBridge(): DesktopBridge | null {
  return (globalThis as { bbDesktop?: DesktopBridge }).bbDesktop ?? null;
}

export async function openBugReport(): Promise<void> {
  const bridge = desktopBridge();
  const nav = typeof navigator === "undefined" ? undefined : (navigator as NavigatorLike);
  const url = bugReportUrl(buildInfo(bridge, await osName(nav)));
  if (bridge?.openExternalUrl) bridge.openExternalUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
