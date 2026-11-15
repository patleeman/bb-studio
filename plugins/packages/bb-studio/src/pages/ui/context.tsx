import { createContext, useContext } from "react";
import type { WhiteboardStroke, WhiteboardView } from "../whiteboard";
import type { BotView, PageMetaView, RecordingCard, StudioEmbedItem } from "../contract";

export interface ArtifactView {
  type: "image" | "html" | "markdown" | "code" | "text" | "pdf" | "other";
  name: string;
  url: string;
  text: string | null;
}

export interface OpenOptions { alternate?: boolean }
export interface LinkOpenOptions { modifiers?: { meta?: boolean; ctrl?: boolean; shift?: boolean } }

/** What block and mention renderers need from the surrounding Pages UI. */
export interface PagesUi {
  pages: PageMetaView[];
  bots: BotView[];
  /** These open in the container the page is in (src/ui/studio-open.tsx); `alternate` (Mod-click) opens in the other place. */
  openPage(pageId: string, options?: OpenOptions): void;
  openThread(threadId: string, options?: OpenOptions): void;
  /** Opens a BB project. */
  openProject(projectId: string): void;
  openUrl(url: string): void;
  /** Opens a BB path, such as another add-on's item. */
  openPath(path: string, options?: OpenOptions): void;
  /** Opens a link's href from page text by the link router's rule (src/links/router.ts): a web URL, an in-app path, a bb:// link, or a page or thread reference. */
  openLink(href: string, options?: LinkOpenOptions): void;
  linkPreview(url: string): Promise<{ title: string; description: string; image: string }>;
  /** Items from the other Studio add-ons (drawings, artifacts, recordings…). */
  studioItems(): Promise<StudioEmbedItem[]>;
  artifactView(id: string): Promise<ArtifactView | null>;
  recording(id: string): Promise<RecordingCard | null>;
  /** Hands a checklist item to an agent; resolves to its thread. */
  handOffChecklist(pageId: string, blockId: string): Promise<{ threadId: string }>;
  /** A drawing embed's scene, for the inline whiteboard. */
  whiteboard(id: string): Promise<WhiteboardView | null>;
  saveWhiteboard(input: { id: string; add: WhiteboardStroke[]; erase: string[] }): Promise<WhiteboardView>;
  /** Makes an item in another add-on, in the page's project. */
  createItem(pageId: string, pluginId: string, kind: string): Promise<StudioEmbedItem>;
  /** Opens the composer on a draft. */
  compose(prompt: string): void;
}

const unavailable = () => Promise.reject(new Error("Not available here."));

export const PagesUiContext = createContext<PagesUi>({
  pages: [],
  bots: [],
  openPage: () => {},
  openThread: () => {},
  openProject: () => {},
  openUrl: (url) => void window.open(url, "_blank", "noopener"),
  openPath: () => {},
  openLink: () => {},
  linkPreview: () => Promise.reject(new Error("No link previews here.")),
  studioItems: () => Promise.resolve([]),
  artifactView: () => Promise.resolve(null),
  recording: unavailable,
  handOffChecklist: unavailable,
  whiteboard: unavailable,
  saveWhiteboard: unavailable,
  createItem: unavailable,
  compose: () => {},
});

export const usePagesUi = () => useContext(PagesUiContext);

/** Display name and colour for a comment/cursor author id. */
export function authorInfo(id: string, bots: BotView[]): { name: string; avatar: string } {
  if (id === "user") return { name: "You", avatar: "" };
  if (id.startsWith("bot:")) {
    const bot = bots.find((candidate) => candidate.id === id.slice(4));
    return { name: bot?.name ?? "Bot", avatar: bot?.avatar ?? "🤖" };
  }
  if (id.startsWith("agent:")) return { name: "Agent", avatar: "✨" };
  return { name: id, avatar: "" };
}
