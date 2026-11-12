// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
