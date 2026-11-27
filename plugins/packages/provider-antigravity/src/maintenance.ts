import { experimental_execHostFile } from "@get-bb/plugin-sdk/process";
import {
  type ProviderInstallationCommand,
  type ProviderInstallationRunResult,
  type ProviderInstallationStatus,
  experimental_compareVersions as compareVersions,
  experimental_downloadedInstallerCommand as downloadedInstallerCommand,
  experimental_formatCommand as formatCommand,
  experimental_installationVerification as installationVerification,
  experimental_resolveExecutablePath as resolveExecutablePath,
  experimental_versionFrom as versionFrom,
} from "@get-bb/plugin-sdk/provider-bridge";

const AGY_COMMAND = "agy";
const AGY_INSTALL_SCRIPT_URL = "https://antigravity.google/install.sh";
const AGY_CHANGELOG_URL = "https://antigravity.google/docs/changelog.md";
const VERSION_PROBE_TIMEOUT_MS = 10_000;
const LATEST_VERSION_TIMEOUT_MS = 10_000;
const LATEST_VERSION_CACHE_TTL_MS = 15 * 60 * 1_000;

let cachedLatest: { value: string | null; expiresAt: number } | null = null;

export function parseLatestCliVersionFromChangelog(
  markdown: string,
): string | null {
  let inCliSection = false;
  for (const line of markdown.split(/\r?\n/u)) {
    if (/^##\s+/u.test(line)) {
      if (inCliSection) break;
      inCliSection = /^##\s+Antigravity CLI\s*$/u.test(line);
      continue;
    }
    if (!inCliSection) continue;
    const match = /^###\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/u.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

export async function probeAgyVersion(): Promise<string | null> {
  try {
    const { stdout, stderr } = await experimental_execHostFile(
      AGY_COMMAND,
      ["--version"],
      { timeout: VERSION_PROBE_TIMEOUT_MS },
    );
    return versionFrom(`${stdout}\n${stderr}`);
  } catch {
    return null;
  }
}

export async function fetchLatestAgyVersion(
  forceRefresh = false,
): Promise<string | null> {
  const now = Date.now();
  if (!forceRefresh && cachedLatest !== null && cachedLatest.expiresAt > now) {
    return cachedLatest.value;
  }
  try {
    const response = await fetch(AGY_CHANGELOG_URL, {
      headers: { Accept: "text/markdown, text/plain" },
      signal: AbortSignal.timeout(LATEST_VERSION_TIMEOUT_MS),
    });
    if (!response.ok) return cachedLatest?.value ?? null;
    const text = await response.text();
    const version = parseLatestCliVersionFromChangelog(text);
    cachedLatest = {
      value: version,
      expiresAt: now + LATEST_VERSION_CACHE_TTL_MS,
    };
    return version;
  } catch {
    return cachedLatest?.value ?? null;
  }
}

export function agyInstallerCommand(): ProviderInstallationCommand {
  return downloadedInstallerCommand(AGY_INSTALL_SCRIPT_URL);
}

export function agyUpdateCommand(): ProviderInstallationCommand {
  const args = ["update"];
  return {
    command: AGY_COMMAND,
    args,
    displayCommand: formatCommand(AGY_COMMAND, args),
  };
}

export async function getAntigravityInstallationStatus(
  checkUpdates = true,
): Promise<ProviderInstallationStatus> {
  const [resolvedExecutable, currentVersion, latestVersion] = await Promise.all([
    resolveExecutablePath(AGY_COMMAND),
    probeAgyVersion(),
    checkUpdates ? fetchLatestAgyVersion() : Promise.resolve(null),
  ]);

  const installed = resolvedExecutable !== null || currentVersion !== null;
  const needsUpdate =
    installed &&
    currentVersion !== null &&
    latestVersion !== null &&
    compareVersions(latestVersion, currentVersion) > 0;

  const actionKind = !installed ? "install" : needsUpdate ? "update" : null;
  const installAction: ProviderInstallationStatus["installAction"] =
    actionKind === null || !checkUpdates
      ? null
      : {
          kind: actionKind,
          label: actionKind === "install" ? "Install" : "Update",
          command:
            actionKind === "install"
              ? agyInstallerCommand().displayCommand
              : agyUpdateCommand().displayCommand,
        };

  return {
    executableName: AGY_COMMAND,
    executablePath: resolvedExecutable,
    installed,
    installSource: installed ? "external" : "notInstalled",
    currentVersion,
    latestVersion,
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction,
    needsUpdate,
    versionUnsupported: false,
  };
}

export async function getAntigravityInstallationRun(
  action: "install" | "update",
): Promise<ProviderInstallationRunResult> {
  const status = await getAntigravityInstallationStatus(true);
  if (action === "install") {
    if (status.installed) {
      return {
        available: false,
        message: "Google Antigravity CLI is already installed on this host.",
      };
    }
    return {
      available: true,
      command: agyInstallerCommand(),
      verification: { kind: "installed" },
    };
  }

  if (!status.installed) {
    return {
      available: false,
      message: "Google Antigravity CLI is not installed on this host.",
    };
  }
  return {
    available: true,
    command: agyUpdateCommand(),
    verification: installationVerification(status, "update"),
  };
}

export function resetLatestVersionCacheForTests(): void {
  cachedLatest = null;
}
