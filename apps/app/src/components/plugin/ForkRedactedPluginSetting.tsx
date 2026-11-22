import { useId, useState, type FocusEvent, type KeyboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { SettingsWithControl } from "@/components/ui/settings-section.js";
import { applyPluginSettingsView } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  updatePluginSettings,
  type PluginSettingFieldDescriptor,
} from "@/hooks/queries/plugin-settings-queries";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

const REDACTED_LABEL = "[redacted";

export function isForkRedactedSetting(
  descriptor: PluginSettingFieldDescriptor,
  storedValue: unknown,
): storedValue is string {
  return (
    descriptor.type === "string" &&
    descriptor.secret !== true &&
    typeof storedValue === "string" &&
    storedValue.includes(REDACTED_LABEL)
  );
}

export function ForkRedactedPluginSetting({
  descriptor,
  pluginId,
  settingKey,
  storedValue,
}: {
  descriptor: PluginSettingFieldDescriptor;
  pluginId: string;
  settingKey: string;
  storedValue: string;
}) {
  const queryClient = useQueryClient();
  const messageId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: string) =>
      updatePluginSettings(fetch, pluginId, { [settingKey]: value }),
    onSuccess: (view) => {
      applyPluginSettingsView({ queryClient, pluginId, view });
      setDraft(null);
    },
  });
  const saveError = save.isError
    ? getMutationErrorMessage({
        error: save.error,
        fallbackMessage: "Could not save this setting",
      })
    : null;

  function cancel(): void {
    setDraft(null);
    save.reset();
  }

  function commit(): void {
    const value = draft?.trim() ?? "";
    if (value !== "" && !save.isPending) save.mutate(value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  function onBlur(event: FocusEvent<HTMLDivElement>): void {
    if (save.isPending) return;
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    cancel();
  }

  return (
    <SettingsWithControl
      label={descriptor.label}
      labelBadge="redacted"
      {...(descriptor.description !== undefined
        ? { description: descriptor.description }
        : {})}
    >
      <div className="space-y-1 @min-[36rem]/settings:w-64">
        {draft === null ? (
          <div className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
              title={storedValue}
              data-testid={`redacted-setting-${settingKey}`}
            >
              {storedValue}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              aria-label={`Replace ${descriptor.label}`}
              onClick={() => setDraft("")}
            >
              Replace
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2" onBlur={onBlur}>
            <Input
              type="text"
              value={draft}
              autoFocus
              aria-label={descriptor.label}
              aria-describedby={saveError !== null ? messageId : undefined}
              aria-invalid={saveError !== null}
              placeholder="New value"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              readOnly={save.isPending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              className="h-7 min-w-0 flex-1 text-xs"
            />
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={(draft?.trim() ?? "") === "" || save.isPending}
              onMouseDown={(event) => event.preventDefault()}
              onClick={commit}
            >
              Save
            </Button>
          </div>
        )}
        {saveError !== null ? (
          <p id={messageId} className="text-xs text-destructive" role="alert">
            {saveError}
          </p>
        ) : null}
      </div>
    </SettingsWithControl>
  );
}
