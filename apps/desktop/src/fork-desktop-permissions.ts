import type {
  DesktopPermissionName,
  DesktopPermissions,
} from "./fork-desktop-control-ipc.js";

export const DESKTOP_PERMISSION_NAMES: readonly DesktopPermissionName[] = [
  "accessibility",
  "screenRecording",
  "inputMonitoring",
];

const SETTINGS_PANES: Record<DesktopPermissionName, string> = {
  accessibility: "Privacy_Accessibility",
  screenRecording: "Privacy_ScreenCapture",
  inputMonitoring: "Privacy_ListenEvent",
};

export function desktopSettingsUrl(permission: DesktopPermissionName): string {
  return `x-apple.systempreferences:com.apple.preference.security?${SETTINGS_PANES[permission]}`;
}

export const NO_PERMISSIONS: DesktopPermissions = {
  accessibility: false,
  screenRecording: false,
  inputMonitoring: false,
  checked: false,
};

export interface PermissionProbe {
  accessibility?: unknown;
  screenRecording?: unknown;
  inputMonitoring?: unknown;
}

export function readPermissions(
  helper: PermissionProbe | null,
  fallback: { accessibility: boolean; screenRecording: boolean },
): DesktopPermissions {
  if (helper === null) {
    return { ...fallback, inputMonitoring: false, checked: true };
  }
  return {
    accessibility: helper.accessibility === true,
    screenRecording: helper.screenRecording === true,
    inputMonitoring: helper.inputMonitoring === true,
    checked: true,
  };
}

export function allPermissionsGranted(
  permissions: DesktopPermissions,
): boolean {
  return (
    permissions.checked &&
    permissions.accessibility &&
    permissions.screenRecording &&
    permissions.inputMonitoring
  );
}

export function screenRecordingNeedsRestart(
  atLaunch: boolean | null,
  now: DesktopPermissions,
): boolean {
  return atLaunch === false && now.screenRecording;
}
