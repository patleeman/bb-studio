import { app, type IpcMain } from "electron";
import {
  FORK_LAUNCH_THEME_GET_CHANNEL,
  FORK_LAUNCH_THEME_SET_CHANNEL,
} from "./fork-launch-theme-ipc.js";
import {
  readLaunchAppearance,
  writeLaunchAppearance,
} from "./fork-launch-theme-file.js";

export function registerForkLaunchThemeIpc(
  ipcMain: IpcMain,
  userDataPath: () => string = () => app.getPath("userData"),
): void {
  ipcMain.on(FORK_LAUNCH_THEME_GET_CHANNEL, (event) => {
    event.returnValue = readLaunchAppearance(userDataPath());
  });
  ipcMain.on(FORK_LAUNCH_THEME_SET_CHANNEL, (_event, value: unknown) => {
    try {
      writeLaunchAppearance(userDataPath(), value);
    } catch {
      return;
    }
  });
}
