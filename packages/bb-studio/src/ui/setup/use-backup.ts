// Backup and Restore on the Setup page (src/backup/register.ts). A backup is
// made on the BB server and downloaded over HTTP; a restore uploads the file
// in chunks, shows a dry run and only changes anything once confirmed.
import { errorMessage } from "@bb-studio/kit/format";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useState } from "react";
import type { backupContract, RestoreResult } from "../../backup-contract";
import { UPLOAD_CHUNK_BYTES } from "../../backup-upload";

export type BackupState =
  | { step: "idle" }
  | { step: "backing-up" }
  | { step: "backed-up"; name: string; bytes: number; text: string; href: string }
  | { step: "uploading"; fileName: string; progress: number }
  | { step: "checking"; fileName: string }
  | { step: "planned"; fileName: string; uploadId: string; plan: RestoreResult }
  | { step: "restoring"; fileName: string; plan: RestoreResult }
  | { step: "restored"; fileName: string; result: RestoreResult }
  | { step: "error"; message: string };

export function backupHref(name: string): string {
  return `/api/v1/plugins/studio/http/backup?name=${encodeURIComponent(name)}`;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

export function useBackup() {
  const rpc = useRpc<typeof backupContract>();
  const [state, setState] = useState<BackupState>({ step: "idle" });

  const backup = useCallback(async () => {
    setState({ step: "backing-up" });
    try {
      const made = await rpc.call("backup.create", null);
      const href = backupHref(made.name);
      setState({ step: "backed-up", name: made.name, bytes: made.bytes, text: made.text, href });
      const link = Object.assign(document.createElement("a"), { href, download: made.name });
      link.click();
    } catch (cause) {
      setState({ step: "error", message: errorMessage(cause) });
    }
  }, [rpc]);

  /** Uploads the file and shows what restoring it would change. */
  const plan = useCallback(async (file: File) => {
    setState({ step: "uploading", fileName: file.name, progress: 0 });
    let uploadId: string | null = null;
    try {
      for (let offset = 0; offset < file.size || offset === 0; offset += UPLOAD_CHUNK_BYTES) {
        const chunk = new Uint8Array(await file.slice(offset, offset + UPLOAD_CHUNK_BYTES).arrayBuffer());
        const sent: { uploadId: string } = await rpc.call("backup.upload", { uploadId, offset, data: base64(chunk) });
        uploadId = sent.uploadId;
        setState({ step: "uploading", fileName: file.name, progress: Math.min(1, (offset + chunk.length) / Math.max(file.size, 1)) });
        if (!file.size) break;
      }
      setState({ step: "checking", fileName: file.name });
      const result = await rpc.call("backup.restore", { uploadId: uploadId!, dryRun: true });
      setState({ step: "planned", fileName: file.name, uploadId: uploadId!, plan: result });
    } catch (cause) {
      // A half-sent or unreadable file would sit on the server until Studio restarts.
      if (uploadId) void rpc.call("backup.discard", { uploadId }).catch(() => {});
      setState({ step: "error", message: errorMessage(cause) });
    }
  }, [rpc]);

  const confirm = useCallback(async () => {
    if (state.step !== "planned") return;
    setState({ step: "restoring", fileName: state.fileName, plan: state.plan });
    try {
      setState({ step: "restored", fileName: state.fileName, result: await rpc.call("backup.restore", { uploadId: state.uploadId, dryRun: false }) });
    } catch (cause) {
      setState({ step: "error", message: errorMessage(cause) });
    }
  }, [rpc, state]);

  const cancel = useCallback(() => {
    if (state.step === "planned") void rpc.call("backup.discard", { uploadId: state.uploadId }).catch(() => {});
    setState({ step: "idle" });
  }, [rpc, state]);

  return { state, backup, plan, confirm, cancel };
}

export type BackupApi = ReturnType<typeof useBackup>;
