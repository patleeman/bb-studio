import { threadListProviderAtom } from "@/components/sidebar/threadListProvider";
import { usePluginSlotKind } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarThreadListSetting() {
  const threadLists = usePluginSlotKind("threadLists");
  return (
    <ReplacementProviderSetting
      label="Sidebar conversation list"
      triggerAriaLabel="Sidebar conversation list"
      description="Which plugin draws your conversations in the sidebar."
      preferenceAtom={threadListProviderAtom}
      slots={threadLists}
    />
  );
}
