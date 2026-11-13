import { useEffect } from "react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../kit/ui/index";
import { allGranted, DESKTOP_PERMISSIONS, type DesktopControl, type DesktopPermission } from "./host";

export function permissionRows(control: DesktopControl) {
  const state = control.state;
  return DESKTOP_PERMISSIONS.map((permission) => ({
    ...permission,
    granted: state?.permissions.checked === true && state.permissions[permission.id],
    checked: state?.permissions.checked === true,
  }));
}

export function PermissionsList({ control }: { control: DesktopControl }) {
  const open = (permission: DesktopPermission) => {
    void control.request({ op: "requestPermission", permission }).finally(() => {
      void control.request({ op: "openSettings", permission });
    });
  };
  return (
    <div className="flex flex-col" data-desktop-permissions="">
      {permissionRows(control).map((row) => (
        <div key={row.id} className="flex items-center gap-3.5 border-t border-border py-3.5" data-permission={row.id} data-granted={row.granted ? "true" : "false"}>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{row.title}</div>
            <div className="text-xs text-muted-foreground">{row.reason}</div>
          </div>
          <span className={row.granted ? "text-xs whitespace-nowrap text-emerald-500" : "text-xs whitespace-nowrap text-amber-500"}>
            {!row.checked ? "Checking" : row.granted ? "✓ Allowed" : "Not yet"}
          </span>
          {row.granted ? null : (
            <Button size="sm" variant="secondary" onClick={() => open(row.id)}>
              Open Settings
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

export function usePermissionPolling(control: DesktopControl, active: boolean) {
  useEffect(() => {
    if (!active || !control.native) return;
    void control.request({ op: "refreshPermissions" });
    const timer = window.setInterval(() => void control.request({ op: "refreshPermissions" }), 2000);
    const onFocus = () => void control.request({ op: "refreshPermissions" });
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [active, control]);
}

export function PermissionsSheet({
  control,
  open,
  onOpenChange,
  onStart,
  onNotNow,
}: {
  control: DesktopControl;
  open: boolean;
  onOpenChange(open: boolean): void;
  onStart(): void;
  onNotNow?(): void;
}) {
  usePermissionPolling(control, open);
  const ready = allGranted(control.state);
  const restart = control.state?.restartAdvised === true;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-desktop-permissions-sheet="">
        <DialogHeader>
          <DialogTitle>Let BB Studio work outside its window</DialogTitle>
        </DialogHeader>
        <PermissionsList control={control} />
        <DialogFooter className="flex items-center gap-2.5 sm:justify-between">
          <span className="flex-1 text-xs text-muted-foreground">
            {restart ? "Screen Recording takes effect after a relaunch." : "macOS may ask you to quit and reopen BB Studio after Screen Recording."}
          </span>
          {restart ? (
            <Button size="sm" variant="secondary" onClick={() => void control.request({ op: "relaunch" })}>
              Relaunch
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => (onNotNow ? onNotNow() : onOpenChange(false))}>
            Not now
          </Button>
          <Button size="sm" disabled={!ready} onClick={onStart} data-start-pointing="">
            Start pointing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
