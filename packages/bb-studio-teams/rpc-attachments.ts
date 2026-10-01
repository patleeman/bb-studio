import { createHash } from "node:crypto";
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { Attachment, rpcContract } from "./contract";
import { imageMime } from "./image-format";
import type { Runtime } from "./runtime";
import type { Store } from "./store";

type AttachmentMethod = "upload" | "discardAttachment" | "transcribe";

export function attachmentHandlers(
  bb: BbPluginApi,
  store: Store,
  runtime: Runtime,
  project: () => Promise<string>,
): Pick<PluginRpcHandlers<typeof rpcContract>, AttachmentMethod> {
  return {
    upload: ({ id, name, mimeType, data }) =>
      runtime.locked(`room:${id}`, async () => {
        store.room(id);
        const projectId = await project();
        const bytes = Buffer.from(data, "base64");
        if (!bytes.length || bytes.length > 8 * 1024 * 1024)
          throw new Error("Attachments must be between 1 byte and 8 MB.");
        const hash = createHash("sha256")
          .update(JSON.stringify([id, name, mimeType]))
          .update(bytes)
          .digest("hex");
        const attachmentId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        try {
          return store.attachment(attachmentId);
        } catch {}
        const detectedImage = imageMime(bytes);
        const attachment: Attachment = {
          id: attachmentId,
          roomId: id,
          projectId,
          name,
          path: "",
          mimeType: detectedImage ?? mimeType,
          type: detectedImage ? "localImage" : "localFile",
          sizeBytes: bytes.length,
        };
        store.stageAttachment(attachment, bytes);
        return attachment;
      }),
    discardAttachment: ({ id, attachmentId }) =>
      runtime.locked(`room:${id}`, async () => {
        const attachment = store.attachment(attachmentId);
        if (attachment.roomId !== id)
          throw new Error("Attachment belongs to a different group.");
        store.discardAttachment(attachmentId);
        return { ok: true as const };
      }),
    transcribe: async ({ data, mimeType, prompt }) => {
      if (!(await bb.sdk.system.config()).voiceTranscriptionEnabled)
        throw new Error("Enable voice transcription in BB settings to use dictation.");
      const bytes = Buffer.from(data, "base64");
      if (!bytes.length || bytes.length > 5 * 1024 * 1024)
        throw new Error("Recording is empty or exceeds 5 MB.");
      return bb.sdk.system.transcribeVoice({
        file: new File(
          [bytes],
          mimeType.includes("mp4") ? "dictation.mp4" : "dictation.webm",
          { type: mimeType },
        ),
        prompt,
      });
    },
  };
}
