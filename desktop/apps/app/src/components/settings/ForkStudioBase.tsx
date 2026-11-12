import type { BbDesktopApi } from "@bb/desktop-contract";
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
