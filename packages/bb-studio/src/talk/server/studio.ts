// Recordings as a Studio kind: the same `studio_*` provider methods the Talk
// add-on published over RPC, called in-process by Studio's hub (src/hub.ts).
import { eachId, type StudioItem, type StudioKind } from "../../kit/contract";
import { mustGet as requireItem, storeActions, storeSearch, type StudioProviderHandlers } from "../../kit/server/index";
import type { Recording } from "../shared/contract";
import { NEW_RECORDING_EVENT, PLUGIN_ID, TALK_ICON, formatLength, recordingBadge, recordingHref } from "../shared/format";
import type { TalkStore } from "./store";
import { extensionFor } from "./audio-files";

const COLUMNS = [
  { id: "length", label: "Length" },
  { id: "words", label: "Words" },
];
const COPY_TRANSCRIPT = { id: "copy-transcript", label: "Copy transcript", icon: "Copy", result: "copy" } as const;

export const RECORDING_KINDS: StudioKind[] = [
  {
    id: "recording",
    label: "Recording",
    plural: "Recordings",
    icon: TALK_ICON,
    columns: COLUMNS,
    actions: [COPY_TRANSCRIPT],
    create: { mode: "event", event: NEW_RECORDING_EVENT },
    canArchive: true,
    capabilities: { create: true, move: true, archive: true, delete: true, rename: true, duplicate: false, export: true, comments: false, versions: false, links: true },
    mentionProviderId: "recordings",
    blurb: "Long voice notes, transcribed.",
    agentHint: "Read the transcript with `bb studio recordings transcript <id>`; `bb studio recordings show <id>` has the details.",
  },
  {
    id: "dictation",
    label: "Dictation",
    plural: "Dictations",
    icon: "Mic",
    columns: COLUMNS,
    actions: [COPY_TRANSCRIPT],
    capabilities: { create: false, move: true, archive: true, delete: true, rename: true, duplicate: false, export: true, comments: false, versions: false, links: false },
    mentionProviderId: "recordings",
    // Dictations start from a composer or a field's microphone.
    create: null,
    canArchive: true,
    // Kept as a safety net, so they stay out of Studio's All view and Home.
    background: true,
    blurb: "Your dictations, with audio.",
    agentHint: "Read the transcript with `bb studio recordings transcript <id>`; `bb studio recordings show <id>` has the details.",
  },
];

const PREVIEW_CHARS = 140;

export function toStudioItem(recording: Recording, transcript: string): StudioItem {
  const text = transcript.replace(/\s+/g, " ").trim();
  return {
    id: recording.id,
    kind: recording.kind,
    title: recording.title,
    icon: null,
    projectId: recording.projectId,
    parentId: null,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt,
    updatedBy: "user",
    preview: text ? (text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : text) : null,
    facts: [
      { id: "length", value: formatLength(recording.durationMs), sort: recording.durationMs },
      { id: "words", value: recording.wordCount.toLocaleString("en-US"), sort: recording.wordCount },
    ],
    badge: recordingBadge(recording) ?? (recording.call ? { label: "Call", tone: "neutral" } : null),
    thumbnailUrl: null,
    href: recordingHref(recording.id),
    archived: recording.archived,
  };
}

/**
 * A window is capturing into it; deleting now would strand the audio still on
 * its way. A paused or interrupted one (its microphone is released) can go.
 */
export function refuseWhileCapturing(recording: Recording | null): void {
  if (recording?.status === "recording") throw new Error("Stop the recording before deleting it.");
}

/**
 * Deletes a recording and its audio. Listeners hear about it even if removing
 * the audio fails after the row is gone; the error still reaches the caller.
 */
export async function deleteRecording(
  deps: { store: Pick<TalkStore, "recording" | "delete">; removeAudio(id: string): Promise<void>; changed(id: string): void },
  id: string,
): Promise<boolean> {
  refuseWhileCapturing(deps.store.recording(id));
  const deleted = deps.store.delete(id);
  try {
    await deps.removeAudio(id);
  } finally {
    if (deleted) deps.changed(id);
  }
  return deleted;
}

/** Studio lists at most this many; past it, Studio keeps tags of items it didn't see. */
const LIST_LIMIT = 10_000;

export function recordingProvider(
  deps: { store: TalkStore; removeAudio(id: string): Promise<void>; readAudio(file: string): Promise<Buffer>; changed(id: string): void },
): StudioProviderHandlers {
  const { store } = deps;
  const mustGet = (id: string) => requireItem((key) => store.recording(key), id, "Recording not found.");
  const unsupported = () => { throw new Error("Recordings can't be duplicated or made into templates."); };

  return {
    studio_duplicate: unsupported,
    studio_template: unsupported,
    studio_instantiate: unsupported,
    // No panel of its own: the kind's collection is Studio's library filtered to it.
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 2, panel: null, kinds: RECORDING_KINDS }),
    studio_get: ({ ids }) => ({ items: ids.flatMap((id) => { const row = store.recording(id); return row ? [toStudioItem(row, store.transcript(id))] : []; }) }),
    studio_read: ({ id }) => {
      const recording = store.recording(id);
      if (!recording) return { content: null };
      const notes = recording.meetingNotes;
      return { content: [notes?.summary, store.transcript(id)].filter(Boolean).join("\n\n") };
    },
    studio_list: () => {
      const rows = store.list({ includeArchived: true, limit: LIST_LIMIT });
      return {
        items: rows.map((recording) => toStudioItem(recording, store.transcript(recording.id))),
        truncated: rows.length === LIST_LIMIT,
      };
    },
    studio_rename: ({ id, title }) =>
      eachId([id], () => {
        mustGet(id);
        store.rename(id, title, "user");
        deps.changed(id);
      }),
    studio_create: () => {
      throw new Error("Start a recording from Talk's microphone.");
    },
    studio_export: async ({ id, format }) => {
      if (format !== "markdown" && format !== "audio" && format !== "bundle") throw new Error(`Unsupported recording format: ${format}`);
      const row = mustGet(id);
      const output = format === "audio" ? [] : [{ name: `${row.title || "Untitled recording"}.md`, mime: "text/markdown", data: Buffer.from(`# ${row.title}\n\n${store.transcript(id)}\n`).toString("base64") }];
      if (format !== "markdown") {
        for (const [index, segment] of store.segments(id).entries()) {
          const entry = store.segmentFile(id, segment.id);
          if (!entry) continue;
          const extension = extensionFor(entry.mimeType);
          output.push({ name: `${String(index + 1).padStart(4, "0")}.${extension}`, mime: entry.mimeType, data: (await deps.readAudio(entry.file)).toString("base64") });
        }
      }
      if (!output.length) throw new Error("Recording has no audio segments.");
      return { files: output };
    },
    studio_action: ({ action, ids }) => {
      if (action !== COPY_TRANSCRIPT.id) throw new Error(`Unknown action "${action}".`);
      const parts = ids.map((id) => {
        const recording = mustGet(id);
        const transcript = store.transcript(id);
        return ids.length === 1 ? transcript : `## ${recording.title}\n\n${transcript || "(No transcript.)"}`;
      });
      return {
        message: ids.length === 1 ? "Transcript copied" : `Copied ${ids.length} transcripts`,
        text: parts.join("\n\n"),
      };
    },
    ...storeActions({
      move: (id: string, projectId: string | null) => {
        mustGet(id);
        store.setProject(id, projectId);
        deps.changed(id);
      },
      archive: (id: string, archived: boolean) => {
        mustGet(id);
        store.setArchived(id, archived);
        deps.changed(id);
      },
      delete: async (id: string) => {
        mustGet(id);
        await deleteRecording(deps, id);
      },
    }),
    studio_search: storeSearch({
      find: (query) => store.list({ query, limit: 200 }),
      text: (recording) => store.transcript(recording.id),
    }),
  };
}
