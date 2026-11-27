import type { SystemCliCommandStatus } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  SettingsSection,
  SettingsWithControl,
} from "@bb/shared-ui/settings-section";
import { useChangeCliCommand } from "@/hooks/mutations/settings-mutations";
import { useCliCommandStatus } from "@/hooks/queries/system-queries";

const CLI_COMMAND_SETTING_LABEL = "bbs CLI";

interface CliCommandSettingsSectionContentProps {
  onChange: (change: "install" | "remove") => void;
  pending: boolean;
  status: SystemCliCommandStatus;
}

export function describeCliCommandStatus(
  status: SystemCliCommandStatus,
): string {
  if (status.installedPath !== null) {
    return status.onPath
      ? `Installed at ${status.installedPath} as bbs and bb-studio. bb is left as it is.`
      : `Installed at ${status.installedPath}, but its folder is not on your PATH.`;
  }
  if (status.shadowedBy === null) {
    return "Installs bbs and bb-studio for terminals and outside agents. bb is left as it is. Conversations in BB Studio already have bbs and bb.";
  }
  if (status.shadowedBy.source === "npm") {
    return `bbs is already installed at ${status.shadowedBy.path}, by npm.`;
  }
  if (status.shadowedBy.source === "machine") {
    return `The machine on this computer added a bbs at ${status.shadowedBy.path} that can run an older bbs. Install replaces it with this one.`;
  }
  return `Another bbs at ${status.shadowedBy.path} comes first on your PATH. Remove it to install this one.`;
}

export function CliCommandSettingsSectionContent({
  onChange,
  pending,
  status,
}: CliCommandSettingsSectionContentProps) {
  const installed = status.installedPath !== null;
  return (
    <SettingsSection title="Command line">
      <SettingsWithControl
        controlPlacement="trailing"
        label={CLI_COMMAND_SETTING_LABEL}
        {...(installed ? { labelBadge: "Installed" } : {})}
        description={describeCliCommandStatus(status)}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            pending ||
            (!installed &&
              status.shadowedBy !== null &&
              status.shadowedBy.source !== "machine")
          }
          onClick={() => onChange(installed ? "remove" : "install")}
          aria-label={`${installed ? "Remove" : "Install"} ${CLI_COMMAND_SETTING_LABEL}`}
        >
          {installed ? "Remove" : "Install"}
        </Button>
      </SettingsWithControl>
    </SettingsSection>
  );
}

export function CliCommandSettingsSection() {
  const statusQuery = useCliCommandStatus();
  const changeCliCommand = useChangeCliCommand();
  const status = statusQuery.data;
  if (status === undefined || !status.supported) {
    return null;
  }

  return (
    <CliCommandSettingsSectionContent
      status={status}
      pending={changeCliCommand.isPending || statusQuery.isRefetching}
      onChange={(change) =>
        changeCliCommand.mutate(change, {
          onSettled: () => {
            void statusQuery.refetch();
          },
        })
      }
    />
  );
}
