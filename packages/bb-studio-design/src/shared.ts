// Names, paths and rules the server and the app share.

export const PLUGIN_ID = "design";
/** The nav panel: /plugins/design/designs, and designs/<id> for one design. */
export const PANEL_PATH = "designs";
export const DESIGN_ICON = "design/design";
/** Realtime channel: the server tells open canvases that a design changed. */
export const REALTIME_CHANNEL = "design";
export const DESIGN_UPDATE_TYPE = "design:updated";
/** The question form's renderer: a pendingInteraction slot the design_ask tool opens. */
export const QUESTIONS_RENDERER = "design-questions";

export function designHref(id: string): string {
  return `/plugins/${PLUGIN_ID}/${PANEL_PATH}/${id}`;
}

/**
 * Version of the script the screen route adds to every screen. Screens are
 * cached forever per revision, so bump this whenever that script changes, or
 * open canvases keep the old copy.
 */
export const SCREEN_SCRIPT_VERSION = 2;

/** `v` changes with every revision and `s` with the screen script, so frames reload only when either changed. */
export function screenUrl(designId: string, screenId: string, updatedAt: number): string {
  return `/api/v1/plugins/${PLUGIN_ID}/http/screen?design=${encodeURIComponent(designId)}&screen=${encodeURIComponent(screenId)}&v=${updatedAt}&s=${SCREEN_SCRIPT_VERSION}`;
}

/** The screen's HTML as the agent wrote it, without the canvas script, as a download. */
export function screenDownloadUrl(designId: string, screenId: string, updatedAt: number): string {
  return `${screenUrl(designId, screenId, updatedAt)}&download=1`;
}

export function isDesignId(value: string): boolean {
  return /^dsn_[0-9a-f]{16}$/.test(value);
}

/**
 * A screen id names its round and its option: "1a" is round 1, option a.
 * Ids stay stable so the user can refer to them in chat.
 */
export const SCREEN_ID = /^([1-9][0-9]{0,2})([a-z])$/;

export function parseScreenId(id: string): { round: number; option: string } | null {
  const match = SCREEN_ID.exec(id);
  return match ? { round: Number(match[1]), option: match[2]! } : null;
}

/** Frame sizes the canvas and the reviewer use. */
export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
  /** A 16:9 presentation slide. */
  slide: { width: 1920, height: 1080 },
} as const;

export type Viewport = keyof typeof VIEWPORTS;
export const VIEWPORT_NAMES = Object.keys(VIEWPORTS) as [Viewport, ...Viewport[]];

/**
 * A slide deck is one screen at the slide size whose steps are its slides,
 * so the canvas lays the slides out and Play presents them.
 */
export function isDeck(screen: Pick<ScreenView, "viewport" | "steps">): boolean {
  return screen.viewport === "slide" && screen.steps.length > 0;
}

/** One step of a prototype: its hash (`#welcome`) and its label. */
export type ScreenStep = { id: string; label: string };

/**
 * The steps a prototype declares, so the canvas can splay it out:
 * `<meta name="bb-design-steps" content="welcome=Welcome; address=Delivery address">`.
 * Each step's id is the URL hash that opens the prototype at it.
 */
export function parseSteps(html: string): ScreenStep[] {
  const tag = /<meta\b[^>]*\bname\s*=\s*["']bb-design-steps["'][^>]*>/i.exec(html)?.[0];
  const content = tag ? /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag) : null;
  const raw = content?.[1] ?? content?.[2] ?? "";
  const steps: ScreenStep[] = [];
  for (const part of raw.split(";")) {
    const [id = "", ...label] = part.split("=");
    const key = id.trim();
    if (/^[A-Za-z0-9_-]{1,40}$/.test(key) && !steps.some((step) => step.id === key))
      steps.push({ id: key, label: label.join("=").trim() || key });
  }
  return steps.slice(0, 24);
}

/** A frame on the canvas: a screen, or one step of it. */
export function frameKey(screenId: string, step: string): string {
  return step ? `${screenId}#${step}` : screenId;
}

export type ScreenView = {
  id: string;
  round: number;
  option: string;
  title: string;
  caption: string;
  viewport: Viewport;
  updatedAt: number;
  /** Declared steps; empty for a single-state screen. */
  steps: ScreenStep[];
};

export type RoundView = { round: number; title: string; intro: string; screens: ScreenView[] };

export type CommentView = {
  id: string;
  screenId: string;
  /** The step it was pinned on, or "" for a screen without steps. */
  step: string;
  selector: string;
  elementText: string;
  body: string;
  createdAt: number;
  /** Whether it went to the design's conversation. */
  sent: boolean;
};

export type DesignView = {
  id: string;
  name: string;
  projectId: string | null;
  /** The design's conversation, once one is started. */
  threadId: string | null;
  updatedAt: number;
  /** Newest round first, as the canvas shows them. */
  rounds: RoundView[];
  /** Open comments, oldest first; their order numbers the pins. */
  comments: CommentView[];
  /** The latest review, while the server remembers it. */
  review: ReviewView | null;
};

export type ReviewView = {
  state: "reviewing" | "done" | "needs_work" | "failed";
  round: number | null;
  screens: string[];
  at: number;
  summary: string | null;
};
