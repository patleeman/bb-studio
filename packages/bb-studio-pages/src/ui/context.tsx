import { createContext, useContext } from "react";
import type { Column, Table, Values } from "@bb-studio/kit/tables";
import type { TableApi } from "@bb-studio/kit/table-grid";
import type { BotView, PageMetaView, RecordingCard, StudioEmbedItem, TaskCard, TaskColumn } from "../contract";

export interface ArtifactView {
  type: "image" | "html" | "markdown" | "code" | "text" | "pdf" | "other";
  name: string;
  url: string;
  text: string | null;
}

/** What block and mention renderers need from the surrounding Pages UI. */
export interface PagesUi {
  pages: PageMetaView[];
  bots: BotView[];
  openPage(pageId: string): void;
  openThread(threadId: string): void;
  openUrl(url: string): void;
  /** Opens a BB path, such as another add-on's item. */
  openPath(path: string): void;
  linkPreview(url: string): Promise<{ title: string; description: string; image: string }>;
  /** Items from the other Studio add-ons (drawings, artifacts, recordings, tasks…). */
  studioItems(): Promise<StudioEmbedItem[]>;
  artifactView(id: string): Promise<ArtifactView | null>;
  /** A live table embed's table, read and edited through Pages. */
  table(id: string): Promise<Table | null>;
  tableApi(id: string): TableApi;
  task(id: string): Promise<{ task: TaskCard | null; columns: TaskColumn[] }>;
  updateTask(input: { id: string; title?: string; status?: string; due?: string | null }): Promise<unknown>;
  recording(id: string): Promise<RecordingCard | null>;
  /** Makes an item in another add-on, in the page's project. */
  createItem(pageId: string, pluginId: string, kind: string): Promise<StudioEmbedItem>;
  createTable(input: { pageId: string; title: string; columns: Column[]; rows: Values[] }): Promise<Table>;
}

const unavailable = () => Promise.reject(new Error("Not available here."));

export const PagesUiContext = createContext<PagesUi>({
  pages: [],
  bots: [],
  openPage: () => {},
  openThread: () => {},
  openUrl: (url) => void window.open(url, "_blank", "noopener"),
  openPath: () => {},
  linkPreview: () => Promise.reject(new Error("No link previews here.")),
  studioItems: () => Promise.resolve([]),
  artifactView: () => Promise.resolve(null),
  table: unavailable,
  tableApi: () => ({ update: unavailable, patchRows: unavailable }),
  task: unavailable,
  updateTask: unavailable,
  recording: unavailable,
  createItem: unavailable,
  createTable: unavailable,
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
