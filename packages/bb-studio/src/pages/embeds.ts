// Live embeds use the built-in kinds directly. The composition root routes
// the item picker and creation through the hub for external add-ons too.
import { untitled } from "../kit/format";
import type { StudioIndexItem } from "../kit/server/index";
import type { BuiltinDrawings } from "../draw/server";
import type { BuiltinArtifacts } from "../artifacts/server";
import type { Recording, Segment } from "../talk/shared/contract";
import { changesData, parseScene, renderWhiteboard, whiteboardChanges, type WhiteboardStroke, type WhiteboardView } from "./whiteboard";
import type { RecordingCard } from "./contract";

export interface EmbedServices {
  items(): Promise<StudioIndexItem[]>;
  create(pluginId: string, kind: string, projectId: string | null): Promise<StudioIndexItem>;
  drawing: BuiltinDrawings["getDrawing"];
  saveDrawing: BuiltinDrawings["saveDrawing"];
  artifact: BuiltinArtifacts["getArtifact"];
  artifactText: BuiltinArtifacts["readText"];
  recording(id: string): { recording: Recording; segments: Segment[] } | null;
}

const MAX_TEXT = 20_000;

export function studioEmbeds(services: EmbedServices) {
  return {
    items: () => services.items(),
    create: (pluginId: string, kind: string, projectId: string | null) => services.create(pluginId, kind, projectId),

    /** A recording as its embed shows it. Talk is built into Studio (its `recordings.*` methods). */
    async recording(id: string): Promise<RecordingCard | null> {
      const result = services.recording(id);
      if (!result) return null;
      const { recording, segments } = result;
      let budget = MAX_TEXT;
      return {
        id: recording.id,
        title: untitled(recording.title),
        status: recording.status,
        durationMs: recording.durationMs,
        createdAt: recording.createdAt,
        summary: recording.meetingNotes?.summary || null,
        decisions: [],
        segments: segments.flatMap((segment) => {
          const text = segment.status === "done" ? (segment.text ?? "").trim() : "";
          if (!text || budget <= 0) return [];
          budget -= text.length;
          const query = `recording=${encodeURIComponent(recording.id)}&segment=${encodeURIComponent(segment.id)}`;
          return [{ id: segment.id, offsetMs: segment.offsetMs, durationMs: segment.durationMs, text, url: `/api/v1/plugins/studio/http/recordings/audio?${query}` }];
        }),
      };
    },
    /** A drawing as the inline whiteboard shows it. Drawings are built into Studio (its `drawings.*` methods). */
    async whiteboard(id: string): Promise<WhiteboardView | null> {
      const drawing = services.drawing(id);
      if (!drawing) return null;
      return { id: drawing.id, name: drawing.name, updatedAt: drawing.updatedAt, ...renderWhiteboard(parseScene(drawing.data)) };
    },
    /** Adds pen strokes and erases elements; Draw merges them into what's there. */
    async saveWhiteboard(id: string, add: WhiteboardStroke[], erase: string[]): Promise<WhiteboardView> {
      const drawing = services.drawing(id);
      if (!drawing) throw new Error("This drawing is gone.");
      const changes = whiteboardChanges(parseScene(drawing.data), add, erase);
      if (changes.length) {
        services.saveDrawing({ id, data: changesData(changes) });
      }
      const view = await this.whiteboard(id);
      if (!view) throw new Error("This drawing is gone.");
      return view;
    },
    async artifactView(id: string) {
      // Artifacts are built into Studio (its `artifacts.*` methods).
      const artifact = services.artifact(id);
      if (!artifact) return null;
      const { version } = artifact;
      let text: string | null = null;
      if (version.type === "markdown" || version.type === "code" || version.type === "text") {
        const result = services.artifactText(id, version.id);
        text = result.text === null ? null : result.text.slice(0, MAX_TEXT) + (result.text.length > MAX_TEXT || result.truncated ? "\n…" : "");
      }
      const query = `artifact=${encodeURIComponent(artifact.id)}&version=${encodeURIComponent(version.id)}`;
      return { type: version.type === "audio" || version.type === "video" ? "other" as const : version.type, name: version.name, url: `/api/v1/plugins/studio/http/artifacts/content?${query}`, text };
    },
  };
}
