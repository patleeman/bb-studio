// Names, paths and file types the server and the app share.

/**
 * Artifacts are built into Studio, but keep the id of the plugin they came
 * from: items stay `artifacts:<id>` in Studio's tables, mentions and links.
 */
export const PLUGIN_ID = "artifacts";
/** The "Artifacts" workbench tab's action id; reply cards open it with `{ artifactId }`. */
export const ARTIFACTS_TAB = "save-to-studio";
/** Studio's panel sub-path: /plugins/studio/studio/artifacts/<id> shows one artifact. */
export const ROUTE_SEGMENT = "artifacts";
export const ARTIFACT_ICON = "studio/artifact";
/** The Artifacts thread panel and its "Save to Studio" button. */
export const SAVE_ICON = "studio/artifact-save";
/** Realtime channel: the server says when an artifact changed. */
export const REALTIME_CHANNEL = "artifacts";
export const ARTIFACT_UPDATE_TYPE = "artifact:updated";
export { MAX_ARTIFACT_BYTES } from "../kit/artifacts-contract";

export function artifactHref(id: string): string {
  return `/plugins/studio/studio/${ROUTE_SEGMENT}/${encodeURIComponent(id)}`;
}

/** A version's bytes. Versions never change, so the response caches forever. */
/** What an HTML preview's quote script posts to the viewer; `text` is null when nothing is selected. */
export const SELECTION_MESSAGE = "bb-artifact-selection";

/** What a live HTML artifact and its viewer post each other (src/artifacts/live). */
export const LIVE_MESSAGE = "bb-artifact-live";
/** Realtime channel: live artifacts' state and the agent's commands. */
export const LIVE_CHANNEL = "artifacts-live";

/**
 * `quote` adds, to HTML, the script that tells the viewer what's selected;
 * `live` adds `window.playground` with the artifact's state and the theme.
 */
export function contentUrl(artifactId: string, versionId: string, options: { download?: boolean; quote?: boolean; live?: "light" | "dark" } = {}): string {
  const query = `artifact=${encodeURIComponent(artifactId)}&version=${encodeURIComponent(versionId)}`;
  return `/api/v1/plugins/studio/http/artifacts/content?${query}${options.download ? "&download=1" : ""}${options.quote ? "&quote=1" : ""}${options.live ? `&live=${options.live}` : ""}`;
}

/** A mention of a take a live artifact sent to the agent: `<artifact id>/take/<take id>`. */
export function takeMentionId(artifactId: string, takeId: string): string {
  return `${artifactId}/take/${takeId}`;
}

export function parseTakeMentionId(id: string): { artifactId: string; takeId: string } | null {
  const match = /^(art_[0-9a-z]{16})\/take\/(take_[0-9a-f]{16})$/.exec(id);
  return match ? { artifactId: match[1]!, takeId: match[2]! } : null;
}

const ID = /^art_[0-9a-z]{16}$/;

export function isArtifactId(value: string): boolean {
  return ID.test(value);
}

/** How the viewer shows a file. */
export type ArtifactType = "image" | "audio" | "video" | "html" | "markdown" | "code" | "text" | "pdf" | "other";

export const TYPE_LABELS: Record<ArtifactType, string> = {
  image: "Image",
  audio: "Audio",
  video: "Video",
  html: "HTML",
  markdown: "Markdown",
  code: "Code",
  text: "Text",
  pdf: "PDF",
  other: "File",
};

export const TYPE_ICONS: Record<ArtifactType, string> = {
  image: "studio/artifact-image",
  audio: "studio/artifact-audio",
  video: "studio/artifact-video",
  html: "Globe",
  markdown: "FileText",
  code: "Code",
  text: "FileText",
  pdf: "FileText",
  other: "File",
};

const IMAGE_MIMES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

/** What browsers play natively; others stay files to download. */
const AUDIO_MIMES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
};

const VIDEO_MIMES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
};

const CODE_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "h", "cc", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "fish", "sql", "css", "scss", "less",
  "json", "jsonc", "yaml", "yml", "toml", "xml", "graphql", "gql", "lua", "r", "dart", "scala", "ex",
  "exs", "erl", "hs", "clj", "vue", "svelte", "tf", "proto", "dockerfile", "makefile", "ini", "env",
]);

const TEXT_EXTENSIONS = new Set(["txt", "log", "csv", "tsv", "text", "rst", "adoc"]);

function extension(name: string): string {
  const base = name.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (base === "dockerfile" || base === "makefile") return base;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

/** The mime type to store for a file, from its name. */
export function mimeFor(name: string): string {
  const ext = extension(name);
  if (IMAGE_MIMES[ext]) return IMAGE_MIMES[ext]!;
  if (AUDIO_MIMES[ext]) return AUDIO_MIMES[ext]!;
  if (VIDEO_MIMES[ext]) return VIDEO_MIMES[ext]!;
  if (ext === "html" || ext === "htm") return "text/html";
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "text/markdown";
  if (ext === "pdf") return "application/pdf";
  if (ext === "json") return "application/json";
  if (ext === "csv") return "text/csv";
  if (CODE_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(ext)) return "text/plain";
  return "application/octet-stream";
}

/** How to show a file, from its name and mime type. */
export function artifactType(name: string, mime: string): ArtifactType {
  const ext = extension(name);
  if (mime.startsWith("image/") || IMAGE_MIMES[ext]) return "image";
  if (mime.startsWith("audio/") || AUDIO_MIMES[ext]) return "audio";
  if (mime.startsWith("video/") || VIDEO_MIMES[ext]) return "video";
  if (mime === "text/html" || ext === "html" || ext === "htm") return "html";
  if (mime === "text/markdown" || ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith("text/")) return "text";
  return "other";
}

/** Types whose bytes are UTF-8 text the viewer, search and Copy can read. */
export function isTextType(type: ArtifactType): boolean {
  return type === "html" || type === "markdown" || type === "code" || type === "text";
}

export { formatBytes } from "../kit/format";

/** The file name at the end of a path. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** A readable title from a file name: "q3-report.html" → "Q3 report". */
export function titleFromName(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const title = stem.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || base;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

type PickerFile = { path: string; artifactId: string | null };

/**
 * "Save to Studio"'s selection after its file list reloads: only paths still
 * offered stay ticked. The first load ticks the reply's unsaved files.
 */
export function prunePicked(current: ReadonlySet<string> | null, files: { reply: readonly PickerFile[]; storage: readonly PickerFile[] }): Set<string> {
  if (!current) return new Set(files.reply.filter((file) => !file.artifactId).map((file) => file.path));
  const offered = new Set([...files.reply, ...files.storage].map((file) => file.path));
  return new Set([...current].filter((path) => offered.has(path)));
}
