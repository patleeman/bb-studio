import type { BbDesktopApi, BbDesktopInfo } from "@bb/desktop-contract";
import type { SystemAppUpdateStatus } from "@bb/server-contract";
import type { ReactNode } from "react";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

type StudioBuild = NonNullable<BbDesktopApi["experimental_studioBuild"]>;

export function formatStudioBase(build: StudioBuild): string {
  return `based on bb ${build.upstreamVersion} @ ${build.upstreamCommit.slice(0, 7)}`;
}

export function ForkStudioBase({ version }: { version: string | null }) {
  const build = getBbDesktopInfo()?.experimental_studioBuild ?? null;
  if (build === null || version !== build.version) return null;
  return (
    <span
      data-fork-studio-base
      className="min-w-0 text-2xs break-words text-muted-foreground"
    >
      {formatStudioBase(build)}
    </span>
  );
}

export const STUDIO_RELEASES_URL =
  "https://github.com/patleeman/bb-studio/releases";

function studioBuild(): StudioBuild | null {
  return getBbDesktopInfo()?.experimental_studioBuild ?? null;
}

export function forkStudioReleaseLink({
  appUpdate,
  desktopInfo,
}: {
  appUpdate: SystemAppUpdateStatus | undefined;
  desktopInfo: BbDesktopInfo | null;
}): ReactNode | undefined {
  if (studioBuild() === null) return undefined;
  const released =
    desktopInfo !== null
      ? desktopInfo.latestVersion !== null
      : appUpdate !== undefined && appUpdate.blocked === null;
  if (!released) return null;
  return (
    <a
      href={STUDIO_RELEASES_URL}
      target="_blank"
      rel="noreferrer"
      data-fork-studio-releases
      className="inline-flex w-fit shrink-0 items-center rounded-sm text-2xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
    >
      Changelog
    </a>
  );
}

export function forkStudioCheckLabel(
  label: string,
  studioLabel: string,
): string {
  return studioBuild() === null ? label : studioLabel;
}
