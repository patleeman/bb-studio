import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopAppUpdateInfo,
  DesktopAppUpdateRequest,
} from "@bb/config/desktop-app-update";
import { createDesktopAppUpdateService } from "../../src/services/system/desktop-app-update.js";
import type { DesktopUpdateChannel } from "../../src/services/system/desktop-update-channel.js";
import type { AppUpdateService } from "../../src/services/system/app-update.js";
import { testLogger } from "../helpers/test-app.js";

const roots: string[] = [];
const services: AppUpdateService[] = [];

function channelWith(info: DesktopAppUpdateInfo): DesktopUpdateChannel {
  return {
    async request(_action: DesktopAppUpdateRequest["action"]) {
      return info;
    },
    subscribe() {
      return () => undefined;
    },
    dispose() {},
  };
}

async function serviceFor(info: DesktopAppUpdateInfo, serverVersion: string) {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-studio-desktop-update-"));
  roots.push(dataDir);
  const service = createDesktopAppUpdateService({
    channel: channelWith(info),
    currentVersion: serverVersion,
    dataDir,
    countRunningThreads: () => 0,
    notifyChanged: vi.fn(),
    logger: testLogger,
    threadsResumeAfterRestart: () => false,
    sendHold: { hold: () => undefined, release: () => undefined },
  });
  services.push(service);
  return service;
}

afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("desktop-owned server update status in BB Studio", () => {
  it("reports the desktop's Studio version, not the bundled server's bb version", async () => {
    const service = await serviceFor(
      {
        supported: true,
        version: "1.0.0",
        latestVersion: "1.0.1",
        pendingVersion: "1.0.1",
        updateAvailable: true,
        updateDownloaded: true,
        downloadState: "downloaded",
      },
      "0.49.0",
    );
    const status = await service.getStatus({ forceRefresh: false });
    expect(status.current.version).toBe("1.0.0");
    expect(status.available?.version).toBe("1.0.1");
  });
});
