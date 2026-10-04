import { useAtomValue } from "jotai";
import { sidebarOrganizationModeAtom } from "../preferences/atoms.js";
import { useStudioSpaces } from "./studioSpaces.js";

/** By space needs a Studio that answers its Spaces RPCs. */
export function useSpaceOrganizeAvailable(): boolean {
  return useStudioSpaces().status === "ready";
}

/** The By space option, with a hint while Studio's Spaces can't load. */
export function SpaceOrganizeHint({ label }: { label: string }) {
  const state = useStudioSpaces();
  const selected = useAtomValue(sidebarOrganizationModeAtom) === "space";
  if (state.status === "ready") return <>{label}</>;
  const hint = state.status === "loading"
    ? "Loading Studio's Spaces…"
    : selected
      ? "Studio's Spaces are unavailable; showing By project"
      : "Needs Studio with Spaces";
  return (
    <span className="flex min-w-0 flex-col" data-sidebar-space-option-hint="">
      <span>{label}</span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </span>
  );
}
