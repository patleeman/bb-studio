// Backup and Restore on the Setup page (src/backup/register.ts). A backup is
// made on the BB server and downloaded over HTTP; a restore uploads the file
// in chunks, shows a dry run and only changes anything once confirmed.
import { errorMessage } from "../../kit/format";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import type { backupContract, RestoreResult } from "../../backup-contract";
import { UPLOAD_CHUNK_BYTES } from "../../backup-upload";

export type BackupState =
  | { step: "idle" }
  | { step: "backing-up" }
  | { step: "backed-up"; name: string; bytes: number; text: string; href: string }
  | { step: "uploading"; fileName: string; progress: number }
  | { step: "checking"; fileName: string }
  | { step: "planned"; fileName: string; uploadId: string; plan: RestoreResult; error?: string }
  | { step: "restoring"; fileName: string; plan: RestoreResult }
  | { step: "restored"; fileName: string; result: RestoreResult; /** Set when something failed: the file stays on the server for another try. */ uploadId: string | null }
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

  type Upload = { id: string; fileName: string; plan: RestoreResult | null; restoring?: boolean };
  const owned = useRef<Upload | null>(null);
  const generation = useRef(0);
  const abandoned = useRef(new Set<string>());
  const discard = useCallback(async (uploadId: string) => {
    abandoned.current.add(uploadId);
    try {
      await rpc.call("backup.discard", { uploadId });
      abandoned.current.delete(uploadId);
    } catch (cause) {
      // Retain failed cleanup for another attempt without replacing the restore error.
      console.warn("Could not discard backup upload", cause);
    }
  }, [rpc]);
  const abandon = useCallback(() => {
    const previous = owned.current;
    owned.current = null;
    if (previous) abandoned.current.add(previous.id);
    for (const id of abandoned.current) void discard(id);
  }, [discard]);
  useEffect(() => () => {
    generation.current += 1;
    abandon();
  }, [abandon]);

  const backup = useCallback(async () => {
    const current = ++generation.current;
    abandon();
    setState({ step: "backing-up" });
    try {
      const made = await rpc.call("backup.create", null);
      if (generation.current !== current) return;
      const href = backupHref(made.name);
      setState({ step: "backed-up", name: made.name, bytes: made.bytes, text: made.text, href });
      const link = Object.assign(document.createElement("a"), { href, download: made.name });
      link.click();
    } catch (cause) {
      if (generation.current === current) setState({ step: "error", message: errorMessage(cause) });
    }
  }, [rpc, abandon]);

  /** Uploads the file and shows what restoring it would change. */
  const plan = useCallback(async (file: File) => {
    const current = ++generation.current;
    abandon();
    setState({ step: "uploading", fileName: file.name, progress: 0 });
    let uploadId: string | null = null;
    try {
      for (let offset = 0; offset < file.size || offset === 0; offset += UPLOAD_CHUNK_BYTES) {
        const chunk = new Uint8Array(await file.slice(offset, offset + UPLOAD_CHUNK_BYTES).arrayBuffer());
        if (generation.current !== current) return;
        const sent: { uploadId: string } = await rpc.call("backup.upload", { uploadId, offset, data: base64(chunk) });
        uploadId = sent.uploadId;
        if (generation.current !== current) { await discard(uploadId); return; }
        owned.current = { id: uploadId, fileName: file.name, plan: null };
        setState({ step: "uploading", fileName: file.name, progress: Math.min(1, (offset + chunk.length) / Math.max(file.size, 1)) });
        if (!file.size) break;
      }
      setState({ step: "checking", fileName: file.name });
      const result = await rpc.call("backup.restore", { uploadId: uploadId!, dryRun: true });
      if (generation.current !== current) { await discard(uploadId!); return; }
      owned.current = { id: uploadId!, fileName: file.name, plan: result };
      setState({ step: "planned", fileName: file.name, uploadId: uploadId!, plan: result });
    } catch (cause) {
      if (uploadId) {
        if (owned.current?.id === uploadId) owned.current = null;
        void discard(uploadId);
      }
      if (generation.current === current) setState({ step: "error", message: errorMessage(cause) });
    }
  }, [rpc, abandon, discard]);

  const confirm = useCallback(async () => {
    const upload = owned.current;
    if (!upload?.plan || upload.restoring) return;
    upload.restoring = true;
    const current = ++generation.current;
    const { id: uploadId, fileName, plan } = upload;
    setState({ step: "restoring", fileName, plan });
    try {
      const result = await rpc.call("backup.restore", { uploadId, dryRun: false });
      if (generation.current !== current) { await discard(uploadId); return; }
      if (!result.failed) owned.current = null;
      setState({ step: "restored", fileName, result, uploadId: result.failed ? uploadId : null });
    } catch (cause) {
      if (generation.current !== current) { await discard(uploadId); return; }
      setState({ step: "planned", fileName, uploadId, plan, error: errorMessage(cause) });
    } finally {
      upload.restoring = false;
    }
  }, [rpc, discard]);

  const cancel = useCallback(() => {
    generation.current += 1;
    abandon();
    setState({ step: "idle" });
  }, [abandon]);

  return { state, backup, plan, confirm, cancel };
}

export type BackupApi = ReturnType<typeof useBackup>;
