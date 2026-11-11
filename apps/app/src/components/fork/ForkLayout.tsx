import { ForkApprovalHost } from "./ForkApprovalHost";
import { ForkItemDropHost } from "./ForkItemDropHost";
import { ForkMainHeader } from "./ForkMainHeader";
import { useNarrowWindowSidebar } from "@/components/layout/useNarrowWindowSidebar.fork";
import { useWorkbenchForkCommands } from "@/components/secondary-panel/workbenchFork";

export { isBareWindow } from "@/lib/fork-bare-window";

export function useForkLayoutBridge([storedOpen, setStoredOpen]: readonly [
  boolean,
  (open: boolean) => void,
]): [boolean, (open: boolean) => void] {
  const { open, setOpen } = useNarrowWindowSidebar(storedOpen, setStoredOpen);
  useWorkbenchForkCommands();
  return [open, setOpen];
}

export function ForkLayoutHosts() {
  return (
    <>
      <ForkMainHeader />
      <ForkApprovalHost />
      <ForkItemDropHost />
    </>
  );
}
