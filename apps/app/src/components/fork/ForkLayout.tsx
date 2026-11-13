import { ForkAppBackdropHost } from "./ForkAppBackdrop";
import { ForkApprovalHost } from "./ForkApprovalHost";
import { ForkItemDropHost } from "./ForkItemDropHost";
import { ForkOverlayScrollbarHost } from "./ForkOverlayScrollbar";
import { ForkTabReturnHost } from "./ForkTabReturnHost";
import { useNarrowWindowSidebar } from "@/components/layout/useNarrowWindowSidebar.fork";
import { useForkTooltipDismiss } from "@/lib/fork-tooltip-dismiss";

export { isBareWindow } from "@/lib/fork-bare-window";

export function useForkLayoutBridge([storedOpen, setStoredOpen]: readonly [
  boolean,
  (open: boolean) => void,
]): [boolean, (open: boolean) => void] {
  const { open, setOpen } = useNarrowWindowSidebar(storedOpen, setStoredOpen);
  return [open, setOpen];
}

export function ForkLayoutHosts() {
  useForkTooltipDismiss();
  return (
    <>
      <ForkAppBackdropHost />
      <ForkApprovalHost />
      <ForkItemDropHost />
      <ForkTabReturnHost />
      <ForkOverlayScrollbarHost />
    </>
  );
}
