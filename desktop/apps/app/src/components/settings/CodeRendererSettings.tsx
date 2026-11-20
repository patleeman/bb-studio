import { composerRendererProviderAtom } from "@/components/promptbox/composer-provider";
import {
  diffRendererProviderAtom,
  sourceCodeRendererProviderAtom,
} from "@/components/code/codeRendererProvider";
import { usePluginSlotKind } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function CodeRendererSettings() {
  const sourceCodeRenderers = usePluginSlotKind("sourceCodeRenderers");
  const diffRenderers = usePluginSlotKind("diffRenderers");
  const composers = usePluginSlotKind("composers");
  return (
    <>
      <ReplacementProviderSetting
        label="Source code"
        triggerAriaLabel="Source code"
        description="Choose automatic activation, BB's viewer, or a specific plugin on this device."
        builtInDescription="Syntax highlighting and gutters from the built-in code theme."
        preferenceAtom={sourceCodeRendererProviderAtom}
        slots={sourceCodeRenderers}
      />
      <ReplacementProviderSetting
        label="Diffs"
        triggerAriaLabel="Diffs"
        description="Applies to file diffs in conversations, the diff panel, and plugin views."
        builtInDescription="Unified and split diffs from the built-in code theme."
        preferenceAtom={diffRendererProviderAtom}
        slots={diffRenderers}
      />
      <ReplacementProviderSetting
        label="Composer"
        triggerAriaLabel="Composer"
        description="The prompt box in conversations, the New conversation screen, and message editors."
        preferenceAtom={composerRendererProviderAtom}
        slots={composers}
      />
    </>
  );
}
