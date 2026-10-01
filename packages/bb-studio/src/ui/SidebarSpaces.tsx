// The Spaces section of the sidebar: one row per space, opening its home, and
// + to make one. Spaces are where the user goes; the Studio collection only
// filters by them.
import { cn, SIDEBAR_ROW, SIDEBAR_ROW_SELECTED, SidebarNote, SidebarPortal, SidebarSection, openAppPath, useProjects, useSidebarHosted, useSidebarNavigated, usePathname } from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbContext, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import type { rpcContract, SpaceView } from "../contract";
import { SpaceDialog, SpaceGlyph, spaceHref } from "./Spaces";

const REFETCH_DEBOUNCE_MS = 300;

function useSpaces(enabled: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [spaces, setSpaces] = useState<SpaceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("spaces", null).then(
      (result) => {
        setSpaces(result.spaces);
        setError(null);
      },
      (cause: unknown) => setError(errorMessage(cause)),
    );
  }, [rpc]);
  useEffect(() => {
    if (enabled) refetch();
  }, [enabled, refetch]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useRealtime(STUDIO_REALTIME_CHANNEL, () => {
    if (!enabled) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(refetch, REFETCH_DEBOUNCE_MS);
  });
  return { spaces, error, refetch, rpc };
}

export function SidebarSpaces() {
  const hosted = useSidebarHosted();
  const path = usePathname();
  const context = useBbContext();
  const projects = useProjects();
  const navigated = useSidebarNavigated();
  const { spaces, error, refetch, rpc } = useSpaces(hosted);
  const [making, setMaking] = useState(false);
  const open = (href: string) => {
    openAppPath(href);
    navigated();
  };

  return (
    <SidebarPortal id="spaces" title="Spaces" order={1}>
      <SidebarSection title="Spaces" actions={[{ label: "New space", icon: "Plus", onClick: () => setMaking(true) }]}>
        {error && !spaces ? <SidebarNote tone="danger">{error}</SidebarNote> : null}
        {spaces && !spaces.length ? <SidebarNote icon="Layers">No spaces yet</SidebarNote> : null}
        <div className="flex flex-col gap-px">
          {spaces?.map((space) => {
            const href = spaceHref(space.id);
            const selected = path === href || path.startsWith(`${href}/`);
            return (
              <a
                key={space.id}
                href={href}
                aria-current={selected ? "page" : undefined}
                className={cn(SIDEBAR_ROW, selected && SIDEBAR_ROW_SELECTED)}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  open(href);
                }}
              >
                <span className="flex size-4 shrink-0 items-center justify-center text-subtle-foreground">
                  <SpaceGlyph space={space} className="text-sm leading-none" />
                </span>
                <span className="min-w-0 flex-1 truncate">{space.name}</span>
              </a>
            );
          })}
        </div>
      </SidebarSection>
      {making ? (
        <SpaceDialog
          rpc={rpc}
          space={null}
          projects={projects}
          defaultProjectId={context.projectId ?? null}
          onClose={() => setMaking(false)}
          onSaved={(saved) => {
            setMaking(false);
            refetch();
            open(spaceHref(saved.id));
          }}
        />
      ) : null}
    </SidebarPortal>
  );
}
