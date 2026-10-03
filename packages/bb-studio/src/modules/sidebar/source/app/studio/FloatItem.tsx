import { openFloat } from "@bb-studio/kit/app";
import { ActionMenuItem } from "../ui/action-menu-items.js";

// The thread menu imports both from here, keeping its upstream patch to one line.
export { useFloatAvailable } from "@bb-studio/kit/app";

export function FloatItem({ threadId, surface }: {
  threadId: string;
  surface: "context" | "dropdown";
}) {
  return (
    <ActionMenuItem
      surface={surface}
      icon="AppWindow"
      onSelect={() => openFloat({ kind: "thread", threadId })}
    >
      Float
    </ActionMenuItem>
  );
}
