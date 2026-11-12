// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SystemAppUpdateStatus } from "@bb/server-contract";
import { STUDIO_RELEASES_URL } from "./ForkStudioBase";
import { BbAppUpdateRows } from "./UpdatesSettingsSection";

const studioBuild = {
  upstreamCommit: "030b1b729f28acedc6f86cd65a71cb3678da8124",
  upstreamVersion: "0.49.0",
  version: "1.0.0",
};

describe("ForkStudioBase", () => {
  afterEach(() => {
    cleanup();
    delete window.bbDesktop;
  });

  it("shows the Studio version and its bb base in the Desktop updates row", () => {
    window.bbDesktop = {
      experimental_studioBuild: studioBuild,
    } as unknown as Window["bbDesktop"];
    const view = render(
      <BbAppUpdateRows
        name="Desktop"
        systemVersion={undefined}
        desktopInfo={{
          lastCheckedAt: null,
          latestVersion: null,
          pendingVersion: null,
          platform: "macos",
          updateAvailable: false,
          updateDownloaded: false,
          version: "1.0.0",
        }}
        isDesktop
        onRelaunchDesktop={null}
        onRetryDesktop={null}
      />,
    );
    expect(
      view.container.querySelector("[data-version-metadata]")?.textContent,
    ).toBe("1.0.0");
    expect(screen.getByText("based on bb 0.49.0 @ 030b1b7")).toBeTruthy();
  });

  it("shows no base next to a version that is not the Studio build's", () => {
    window.bbDesktop = {
      experimental_studioBuild: studioBuild,
    } as unknown as Window["bbDesktop"];
    const view = render(
      <BbAppUpdateRows
        name="Desktop"
        systemVersion={undefined}
        desktopInfo={{
          lastCheckedAt: null,
          latestVersion: null,
          pendingVersion: null,
          platform: "macos",
          updateAvailable: false,
          updateDownloaded: false,
          version: "0.49.0",
        }}
        isDesktop
        onRelaunchDesktop={null}
        onRetryDesktop={null}
      />,
    );
    expect(view.container.querySelector("[data-fork-studio-base]")).toBeNull();
  });

  it("shows nothing extra outside BB Studio's desktop build", () => {
    window.bbDesktop = {} as unknown as Window["bbDesktop"];
    const view = render(
      <BbAppUpdateRows
        name="Desktop"
        systemVersion={undefined}
        desktopInfo={{
          lastCheckedAt: null,
          latestVersion: null,
          pendingVersion: null,
          platform: "macos",
          updateAvailable: false,
          updateDownloaded: false,
          version: "1.0.0",
        }}
        isDesktop
        onRelaunchDesktop={null}
        onRetryDesktop={null}
      />,
    );
    expect(view.container.querySelector("[data-fork-studio-base]")).toBeNull();
  });

  function serverRow(blocked: SystemAppUpdateStatus["blocked"]) {
    window.bbDesktop = {
      experimental_studioBuild: studioBuild,
    } as unknown as Window["bbDesktop"];
    const status: SystemAppUpdateStatus = {
      activity: { phase: "idle" },
      available: null,
      blocked,
      current: { commit: null, version: "1.0.0" },
      lastResult: null,
      autoUpdate: false,
      availableSkipped: false,
      runningThreadCount: 0,
      scheduled: null,
      support: { kind: "unsupported", reason: "desktop" },
      desktopUpdateSupported: true,
    };
    return render(
      <BbAppUpdateRows
        systemVersion={undefined}
        appUpdate={status}
        desktopInfo={null}
        isDesktop={false}
        onRetryAppCheck={() => {}}
        onRelaunchDesktop={null}
        onRetryDesktop={null}
        releaseNotes={{
          version: "0.49.0",
          panelId: "notes",
          expanded: false,
          onToggle: () => {},
        }}
      />,
    );
  }

  it("says no BB Studio release was found, offers Check and hides the changelog", () => {
    const view = serverRow({
      reason: "fetch-failed",
      message: "No BB Studio release found.",
    });
    expect(screen.getByText("No BB Studio release found.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Check for BB Studio releases/ })
        .textContent,
    ).toBe("Check");
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(screen.queryByText("Changelog")).toBeNull();
    expect(
      view.container.querySelector("[aria-label^='Changelog for bb']"),
    ).toBeNull();
  });

  it("links the changelog to BB Studio's releases once a release is found", () => {
    serverRow(null);
    const link = screen.getByText("Changelog").closest("a");
    expect(link?.getAttribute("href")).toBe(STUDIO_RELEASES_URL);
    expect(link?.getAttribute("href")).toBe(
      "https://github.com/patleeman/bb-studio/releases",
    );
  });
});
