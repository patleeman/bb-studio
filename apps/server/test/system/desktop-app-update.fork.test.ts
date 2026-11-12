import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function channelWith(info: DesktopAppUpdateInfo | null): DesktopUpdateChannel {
  return {
    async request(_action: DesktopAppUpdateRequest["action"]) {
      if (info === null) throw new Error("The desktop app did not respond.");
      return info;
    },
    subscribe() {
      return () => undefined;
    },
    dispose() {},
  };
}

async function serviceFor(
  info: DesktopAppUpdateInfo | null,
  serverVersion: string,
  pending: { from: string; to: string } | null = null,
) {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-studio-desktop-update-"));
  roots.push(dataDir);
  if (pending !== null) {
    await writeFile(
      join(dataDir, "bb-desktop-app-update.json"),
      JSON.stringify({
        schemaVersion: 1,
        lastResult: null,
        pending: {
          acknowledged: false,
          finishedAt: new Date().toISOString(),
          from: { commit: null, version: pending.from },
          id: "update-1",
          logTail: [],
          message: null,
          outcome: "failed",
          phase: "prepare",
          to: { commit: null, version: pending.to },
        },
      }),
    );
  }
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

  it("says no BB Studio release was found while the feed has none", async () => {
    const service = await serviceFor(
      {
        supported: true,
        version: "1.0.0",
        latestVersion: null,
        pendingVersion: null,
        updateAvailable: false,
        updateDownloaded: false,
        downloadState: "idle",
      },
      "0.49.0",
    );
    const status = await service.getStatus({ forceRefresh: false });
    expect(status.blocked).toEqual({
      reason: "fetch-failed",
      message: "No BB Studio release found.",
    });
  });

  it("records a Studio update as updated when the desktop restarts on the new Studio version", async () => {
    const service = await serviceFor(
      {
        supported: true,
        version: "1.0.2",
        latestVersion: "1.0.2",
        pendingVersion: null,
        updateAvailable: false,
        updateDownloaded: false,
        downloadState: "idle",
      },
      "0.49.0",
      { from: "1.0.1", to: "1.0.2" },
    );
    const status = await service.getStatus({ forceRefresh: false });
    expect(status.lastResult).toMatchObject({
      outcome: "updated",
      message: null,
      phase: null,
      from: { version: "1.0.1" },
      to: { version: "1.0.2" },
    });
  });

  it("still flags a Studio update that restarted on the old version", async () => {
    const service = await serviceFor(
      {
        supported: true,
        version: "1.0.1",
        latestVersion: "1.0.2",
        pendingVersion: "1.0.2",
        updateAvailable: true,
        updateDownloaded: true,
        downloadState: "downloaded",
      },
      "0.49.0",
      { from: "1.0.1", to: "1.0.2" },
    );
    const status = await service.getStatus({ forceRefresh: false });
    expect(status.lastResult).toMatchObject({
      outcome: "failed",
      phase: "startup",
      message: "BB Studio started 1.0.1 instead of 1.0.2.",
    });
  });

  it("records the desktop's Studio version as the version an update starts from", async () => {
    const service = await serviceFor(
      {
        supported: true,
        version: "1.0.1",
        latestVersion: "1.0.2",
        pendingVersion: "1.0.2",
        updateAvailable: true,
        updateDownloaded: false,
        downloadState: "failed",
      },
      "0.49.0",
    );
    await service.getStatus({ forceRefresh: false });
    await service.apply({ runningThreads: { kind: "refuse" } });
    await vi.waitFor(async () =>
      expect(
        (await service.getStatus({ forceRefresh: false })).lastResult,
      ).toMatchObject({
        outcome: "failed",
        from: { version: "1.0.1" },
        to: { version: "1.0.2" },
      }),
    );
  });

  it("keeps the update pending when the desktop does not say what it runs", async () => {
    const service = await serviceFor(null, "0.49.0", {
      from: "1.0.1",
      to: "1.0.2",
    });
    const status = await service.getStatus({ forceRefresh: false });
    expect(status.lastResult).toBeNull();
    const dataDir = roots.at(-1) ?? "";
    const stored = JSON.parse(
      await readFile(join(dataDir, "bb-desktop-app-update.json"), "utf8"),
    ) as { pending: { to: { version: string } } | null };
    expect(stored.pending?.to.version).toBe("1.0.2");
  });
});
