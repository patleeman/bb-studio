// Custom block and inline-content configs shared by the server schema
// (src/schema-server.ts) and the React editor (components/blocks). Both sides
// must build the same ProseMirror schema, so every custom type's config lives
// here and each side only supplies a renderer.

export const calloutConfig = {
  type: "callout",
  propSchema: {
    tone: { default: "info", values: ["info", "success", "warning", "danger"] as const },
  },
  content: "inline",
} as const;

/** `spec` is ChartSpec JSON (see src/chart-spec.ts). */
export const chartConfig = {
  type: "chart",
  propSchema: {
    spec: { default: "" },
  },
  content: "none",
} as const;

/** `items` is StatItem[] JSON (see src/chart-spec.ts). */
export const statsConfig = {
  type: "stats",
  propSchema: {
    items: { default: "[]" },
  },
  content: "none",
} as const;

/** A Mermaid diagram; its source is the block's plain-text content. */
export const mermaidConfig = {
  type: "mermaid",
  propSchema: {},
  content: "plain",
} as const;

/**
 * Raw HTML, shown in a sandboxed iframe (scripts, no same-origin access); its
 * source is the block's plain-text content.
 */
export const htmlConfig = {
  type: "html",
  propSchema: {},
  content: "plain",
} as const;

/** The longest HTML source an ```html fence may hold; longer ones stay code. */
export const MAX_HTML_CHARS = 200_000;

export const EMBED_KINDS = ["thread", "page", "bookmark", "drawing", "artifact", "recording", "task", "board", "table", "item"] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];

/**
 * Embeds of other Studio add-ons' items. Their target is the item's id; an
 * "item" embed reaches any add-on with a `pluginId:itemId` target. A table's
 * or board's target may name the view it shows: `<table id>/view/<view id>`,
 * `<board id>/view/list`. Tasks and boards share an add-on; their ids'
 * prefixes tell them apart.
 */
export const STUDIO_EMBEDS = {
  drawing: { pluginId: "excalidraw", panel: "drawings", label: "Drawing" },
  artifact: { pluginId: "artifacts", panel: "artifacts", label: "Artifact" },
  recording: { pluginId: "talk", panel: "recordings", label: "Recording" },
  task: { pluginId: "studio-tasks", panel: "tasks", label: "Task", idPrefix: "tsk_" },
  board: { pluginId: "studio-tasks", panel: "tasks", label: "Board", idPrefix: "brd_" },
  table: { pluginId: "studio-tables", panel: "tables", label: "Table" },
} as const;
export type StudioEmbedKind = keyof typeof STUDIO_EMBEDS;

/** Whether an add-on's item is the kind an embed shows. */
export function isEmbedKindItem(kind: StudioEmbedKind, pluginId: string, id: string): boolean {
  const embed: { pluginId: string; idPrefix?: string } = STUDIO_EMBEDS[kind];
  return embed.pluginId === pluginId && (!embed.idPrefix || id.startsWith(embed.idPrefix));
}

/** The ways a board embed shows its tasks. */
export const BOARD_EMBED_VIEWS = ["board", "list"] as const;
export type BoardEmbedView = (typeof BOARD_EMBED_VIEWS)[number];

/** A board embed's target: `<board id>`, or `<board id>/view/list`. */
export function parseBoardTarget(target: string): { boardId: string; view: BoardEmbedView } {
  const [boardId = "", , view] = target.split("/");
  return { boardId, view: view === "list" ? "list" : "board" };
}

export function boardTarget(boardId: string, view: BoardEmbedView): string {
  return view === "board" ? boardId : `${boardId}/view/${view}`;
}

export function isStudioEmbed(kind: string): kind is StudioEmbedKind | "item" {
  return kind === "item" || kind in STUDIO_EMBEDS;
}

/** The add-on item an embed or mention points at, if it points at one. */
export function studioRef(kind: string, target: string): { pluginId: string; id: string } | null {
  if (kind === "table" || kind === "board") {
    const [id] = target.split("/");
    return id ? { pluginId: STUDIO_EMBEDS[kind].pluginId, id } : null;
  }
  if (kind in STUDIO_EMBEDS) return target ? { pluginId: STUDIO_EMBEDS[kind as StudioEmbedKind].pluginId, id: target } : null;
  if (kind !== "item") return null;
  const split = target.indexOf(":");
  return split > 0 && split < target.length - 1 ? { pluginId: target.slice(0, split), id: target.slice(split + 1) } : null;
}

/** The embed kind and target for an add-on's item. */
export function studioEmbedFor(pluginId: string, id: string): { kind: StudioEmbedKind | "item"; target: string } {
  const kind = (Object.keys(STUDIO_EMBEDS) as StudioEmbedKind[]).find((each) => isEmbedKindItem(each, pluginId, id));
  return kind ? { kind, target: id } : { kind: "item", target: `${pluginId}:${id}` };
}

export const embedConfig = {
  type: "embed",
  propSchema: {
    kind: { default: "bookmark", values: EMBED_KINDS },
    target: { default: "" },
    title: { default: "" },
    description: { default: "" },
    /** A bookmark's preview image URL. */
    image: { default: "" },
  },
  content: "none",
} as const;

export const MENTION_KINDS = ["bot", "page", "thread", "date", "agent", "item"] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];

export const mentionConfig = {
  type: "mention",
  propSchema: {
    kind: { default: "bot", values: MENTION_KINDS },
    target: { default: "" },
    label: { default: "" },
  },
  content: "none",
} as const;

/** The Y.XmlFragment the editor binds to; comments live in THREADS_MAP. */
export const DOCUMENT_FRAGMENT = "document";
export const THREADS_MAP = "threads";

/** Kind, badge and facts, without repeats or bare counts that mean nothing out of their column. */
export function studioSubtitle(item: { kindLabel: string; badge: string | null; facts: string[] }): string {
  const parts = [item.kindLabel, item.badge, ...item.facts].filter((part): part is string => !!part && !/^\d+$/.test(part));
  return [...new Set(parts)].join(" · ");
}
