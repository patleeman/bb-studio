import { useStudioChatPresent } from "@bb-studio/kit/app";
import { STUDIO_CHAT_FLOAT_EVENT } from "@bb-studio/kit/contract";
import { ActionMenuItem } from "../ui/action-menu-items.js";

export function useStudioChatFloat() {
  return useStudioChatPresent() === true;
}

export function StudioChatFloatItem({ threadId, surface }: {
  threadId: string;
  surface: "context" | "dropdown";
}) {
  return (
    <ActionMenuItem
      surface={surface}
      icon="SideChat"
      onSelect={() => window.dispatchEvent(
        new CustomEvent(STUDIO_CHAT_FLOAT_EVENT, { detail: { threadId } }),
      )}
    >
      Float in Studio Chat
    </ActionMenuItem>
  );
}
