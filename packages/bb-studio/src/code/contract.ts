import { codeContract as legacy } from "../kit/code-contract";
export const rpcContract = {
  "code.get": legacy.get,
  "code.update": legacy.update,
  "code.open": legacy.open,
  "code.stop": legacy.stop,
  "code.threadWorkspace": legacy.threadWorkspace,
  "code.forThread": legacy.forThread,
  "code.listDir": legacy.listDir,
  "code.readFile": legacy.readFile,
  "code.reveal": legacy.reveal,
  "code.viewedFrom": legacy.viewedFrom,
  "code.editorState": legacy.editorState,
  "code.syncTheme": legacy.syncTheme,
};
export type CodeContract = typeof rpcContract;
