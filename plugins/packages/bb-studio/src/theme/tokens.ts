import { oklchCss, over, pct, type Rgb } from "./color";
import { HALO_LAYERS, type ResolvedLook } from "./look";
import { SURFACES } from "./schema";

const opaque = (base: string, share: number, other: string) => `color-mix(in oklch, ${base} ${pct(share)}, ${other})`;
const translucent = (base: string, share: number) => `color-mix(in oklab, ${base} ${pct(share)}, transparent)`;

export type ThemeTokens = Record<`--${string}`, string>;

export const CARD_GAP = 10;
export const CARD_RADIUS = 8;

export const DIFF_CARD_FILL = 0.32;
export const DIFF_GUTTER_ALPHA = 0.9;

export function diffBody(look: ResolvedLook, surface: "transcript" | "composer", scene: Rgb = look.scene): Rgb {
  return over(look.canvas, DIFF_CARD_FILL, over(look.canvas, look.alpha[surface], scene));
}

const diffGutter = (look: ResolvedLook, surface: "transcript" | "composer") => translucent(oklchCss(diffBody(look, surface)), DIFF_GUTTER_ALPHA);

export function haloShadow(color: string): string {
  return HALO_LAYERS.map((layer) => `0 0 ${layer.blur}px ${translucent(color, layer.alpha)}`).join(", ");
}

export function lookTokens(look: ResolvedLook): ThemeTokens {
  const accent = oklchCss(look.accent);
  const error = oklchCss(look.error);
  const warning = oklchCss(look.warning);
  const success = oklchCss(look.success);
  const sidebar = oklchCss(look.sidebar);
  const selection = oklchCss(look.selection);
  const errorText = opaque(error, look.shares.errorText, "var(--ink)");
  const successText = opaque(success, look.shares.successText, "var(--ink)");
  const tokens: ThemeTokens = {
    "--canvas": oklchCss(look.canvas),
    "--ink": oklchCss(look.ink),
    "--sidebar": look.glassy ? translucent(sidebar, look.alpha.sidebar) : sidebar,
    "--primary": accent,
    "--primary-foreground": oklchCss(look.accentInk),
    "--ring": "var(--primary)",
    "--sidebar-ring": "var(--primary)",
    "--muted-foreground": opaque("var(--ink)", look.shares.muted, "var(--canvas)"),
    "--subtle-foreground": opaque("var(--ink)", look.shares.subtle, "var(--canvas)"),
    "--readback-foreground": opaque("var(--ink)", look.shares.readback, "var(--canvas)"),
    "--destructive": error,
    "--destructive-text": errorText,
    "--diff-removed": errorText,
    "--warning": warning,
    "--warning-text": opaque(warning, look.shares.warningText, "var(--ink)"),
    "--attention": oklchCss(look.needsYou),
    "--success": successText,
    "--diff-added": successText,
    "--surface-selected": translucent(selection, look.shares.selection),
    "--sidebar-accent": translucent(selection, look.shares.selection),
    "--font-sans": look.fonts.body,
    "--font-mono": look.fonts.mono,
    "--radius": `${Math.round((look.radius / 16) * 1000) / 1000}rem`,
    "--studio-font-heading": look.fonts.heading,
    "--studio-font-transcript": look.fonts.transcript ?? look.fonts.body,
    "--studio-accent": accent,
    "--studio-accent-text": opaque(accent, look.shares.accentText, "var(--ink)"),
    "--studio-selection": translucent(selection, Math.min(0.45, look.shares.selection + 0.1)),
    "--studio-worker": oklchCss(look.worker),
    "--studio-needs-you": oklchCss(look.needsYou),
    "--studio-finished": oklchCss(look.finished),
    "--studio-error": oklchCss(look.ripple),
    "--studio-hud-glass": pct(look.alpha.hud),
    "--studio-glass-saturate": String(Math.round(look.saturate * 100) / 100),
    "--studio-card-radius": `${CARD_RADIUS}px`,
    "--studio-halo": look.halo > 0 ? haloShadow("var(--canvas)") : "none",
  };
  if (look.glassy) {
    tokens["--studio-diff-gutter"] = diffGutter(look, "transcript");
    tokens["--studio-diff-gutter-panel"] = diffGutter(look, "composer");
  }
  if (look.glassy) tokens["--fork-cards-icon-halo"] = `drop-shadow(0 0 1px var(--canvas)) drop-shadow(0 0 3px var(--canvas)) drop-shadow(0 0 8px ${translucent("var(--canvas)", 0.7)})`;
  if (look.fonts.headingWeight !== undefined) tokens["--studio-font-heading-weight"] = String(look.fonts.headingWeight);
  for (const surface of SURFACES) {
    tokens[`--studio-glass-${surface}`] = translucent(surface === "sidebar" ? sidebar : "var(--canvas)", look.alpha[surface]);
    tokens[`--studio-blur-${surface}`] = `${Math.round(look.blur[surface])}px`;
  }
  return tokens;
}

export const THEME_ATTRIBUTE = "data-studio-theme";
export const EFFECTS_ATTRIBUTE = "data-studio-effects";
export const STILL_ATTRIBUTE = "data-studio-still";
export const CROSSFADE_ATTRIBUTE = "data-studio-crossfade";
export const GLASS_ATTRIBUTE = "data-studio-glass";
export const HEADING_WEIGHT_ATTRIBUTE = "data-studio-heading-weight";
export const HEADINGS = `:where(h1, h2, h3, [data-studio-heading]):not([data-thread-window] *)`;

const ON = `html[${THEME_ATTRIBUTE}]`;
const GLASS = `html[${GLASS_ATTRIBUTE}]`;
const MAIN_THREAD = `[data-thread-window]:not([data-surface-tone])`;
const OPEN = `${GLASS} ${MAIN_THREAD}`;
export const COLUMN_SELECTOR = `${MAIN_THREAD} [data-scroll-attached]`;
const filterOf = (surface: string) => `blur(var(--studio-blur-${surface})) saturate(var(--studio-glass-saturate))`;
const cardOf = (surface: string) => `background: var(--studio-glass-${surface}); -webkit-backdrop-filter: ${filterOf(surface)}; backdrop-filter: ${filterOf(surface)}; border: 0; border-radius: var(--studio-card-radius); box-shadow: var(--fork-cards-shadow, none);`;

const PAGES = `${GLASS} [data-sidebar="inset"]:not(:has(${MAIN_THREAD}))`;
export const COLUMN_PAGE_ATTRIBUTE = "data-bot-page";
export const PILL_ATTRIBUTE = "data-studio-pill";
export const PILL_SELECTOR = `${GLASS} [${PILL_ATTRIBUTE}]`;

export const BACKING_SELECTORS = {
  pages: `${PAGES}:has([data-testid="plugin-panel-body"]):not(:has([${COLUMN_PAGE_ATTRIBUTE}]))`,
  composerReplace: `${OPEN} [data-fork-composer-replace]`,
  threadBanner: `${OPEN} [data-fork-thread-banner]`,
  composerControls: `${OPEN} [data-fork-composer-replace] :is(button, a)`,
} as const;

export const PAGE_ROOTS = `${PAGES} :is(.studio-root.bg-background, [${COLUMN_PAGE_ATTRIBUTE}])`;

export const HALO_SELECTORS = {
  column: `${GLASS} ${COLUMN_SELECTOR}`,
  pages: PAGES,
  header: `${GLASS} [data-sidebar="inset"] header`,
  sidebar: `${GLASS} [data-sidebar="sidebar"]`,
} as const;

const TABLES = `${GLASS} [data-thread-window] [data-markdown-preview]`;
export const TABLE_CSS = `
${TABLES} .overflow-x-auto:has(> table) { background: var(--studio-glass-transcript); -webkit-backdrop-filter: blur(var(--studio-blur-transcript)) saturate(var(--studio-glass-saturate)); backdrop-filter: blur(var(--studio-blur-transcript)) saturate(var(--studio-glass-saturate)); border-radius: var(--studio-card-radius); box-shadow: 0 14px 40px -14px color-mix(in oklab, black 35%, transparent); }
${TABLES} :has(> .overflow-x-auto > table)::before, ${TABLES} :has(> .overflow-x-auto > table)::after { display: none; }
${TABLES} table { border: 0; }
${TABLES} table :is(th, td) { border: 0; border-bottom: 1px solid color-mix(in oklab, var(--ink) 8%, transparent); }
${TABLES} table tr:last-child td { border-bottom: 0; }
`;

const INSET = `${GLASS} [data-sidebar="inset"]`;
const BARE = `background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: none; border-color: transparent;`;
const BAR_HALO = `filter: drop-shadow(0 0 2px color-mix(in oklab, var(--canvas) 90%, transparent)) drop-shadow(0 0 6px color-mix(in oklab, var(--canvas) 60%, transparent));`;
export const LIST_PAGE = `${INSET} header + main > div:has([data-resource-collection-viewport]):not(:has(.box-border.h-full.w-full, [data-page-scroll-viewport]))`;
export const RULE_CLASSES = ["border-b", "border-t", "border-y", "border-l", "border-r", "border-x"] as const;
export const RULES = `${INSET} .studio-root :is(${RULE_CLASSES.map((each) => `[class~="${each}"]`).join(", ")}, [class*="divide-y"] > *, [class*="divide-x"] > *)`;
export const HEADER_ROW = `${INSET} header > [data-testid="app-page-header-content-row"]`;
export const TITLE_BOX = `${HEADER_ROW} > div:has(> [data-fork-title-home]):not([data-studio-bar-label])`;
export const PAGE_BAR_BOX = `${HEADER_ROW} [data-studio-page-bar="column"]`;
const TITLE_BOXES = `:is(${TITLE_BOX}, ${PAGE_BAR_BOX})`;
const CONTROLS_END = `calc(var(--bb-window-title-bar-controls-end) + 12px - var(--bb-window-card-collapsed-left))`;
const RESERVED_ROW = `${HEADER_ROW}[class*="bb-window-title-bar-controls-end"]`;

const FRAMED = `${GLASS} [data-testid="app-layout-root"][data-framed]`;
const EDGE_GAP = `calc(var(--fork-cards-gap, 10px) - var(--bb-frame-window-lip, 0px))`;
export const WORKBENCH_SCOPE = `${FRAMED} [data-sidebar="inset"] aside[data-surface-tone="sidebar"]:not([inert], [data-app-content-shell] > header ~ * aside)`;
export const WORKBENCH = `:is(${WORKBENCH_SCOPE})`;
const PANE_HEADS = [`${WORKBENCH} > div:not([data-sidebar-split-container]) > :first-child`, `${WORKBENCH} [data-split-pane-id] > section > :first-child`];
export const WORKBENCH_STRIP = `:is(${PANE_HEADS.join(", ")})`;
export const WORKBENCH_BODY = `:is(${PANE_HEADS.map((each) => `${each} ~ *`).join(", ")})`;

export const SHADOW_CLIP_SELECTORS = [
  `${GLASS} [data-sidebar="sidebar"] > :has(> [data-sidebar="collapsible-body"])::before`,
  `${GLASS} [data-sidebar="inset"] ${MAIN_THREAD} [data-page-scroll-viewport] > div::before`,
  `${GLASS} [data-sidebar="inset"] [data-fork-card="main"]`,
  WORKBENCH_BODY,
] as const;
export const SCROLLER_SELECTORS = [
  `${GLASS} [data-testid="edit-space-pane"]`,
] as const;
export const GUTTER_CSS = `
${SHADOW_CLIP_SELECTORS.join(", ")} { clip-path: inset(-60px 0); }
${FRAMED} [data-sidebar="inset"] { margin-right: ${EDGE_GAP}; margin-bottom: ${EDGE_GAP}; height: calc(100% + var(--bb-window-title-bar-height) - ${EDGE_GAP}); padding-bottom: 0; }
${FRAMED} [data-sidebar="inset"] header.box-content { padding-bottom: 0; }
${FRAMED} [data-sidebar="sidebar"] > :has(> [data-sidebar="collapsible-body"]) { padding-top: 0; padding-bottom: ${EDGE_GAP}; }
${WORKBENCH} { top: 0; height: 100%; }
${WORKBENCH}, ${WORKBENCH} [data-split-pane-id] { background: none; -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: none; border-radius: 0; overflow: visible; }
${WORKBENCH} > [data-sidebar-split-container], ${WORKBENCH} [data-split-pane-id] > section { overflow: visible; background: none; }
${WORKBENCH_STRIP} { box-sizing: border-box; height: var(--bb-window-title-bar-height); ${BAR_HALO} }
${WORKBENCH_STRIP} > [data-testid="thread-secondary-panel-top-chrome"] { height: 100%; }
${WORKBENCH_BODY} { background: var(--fork-surface-secondary-panel-background, transparent); -webkit-backdrop-filter: var(--fork-surface-secondary-panel-backdrop-filter, none); backdrop-filter: var(--fork-surface-secondary-panel-backdrop-filter, none); border-radius: var(--studio-card-radius); box-shadow: var(--fork-cards-shadow, none); }
${WORKBENCH} [data-sidebar-split-root-direction="row"] > [data-split-pane-id]:not([data-split-pane-id="pane-primary"]) { padding-left: var(--fork-cards-gap, 10px); }
${WORKBENCH} [data-split-pane-id] > [data-pane-focus-scrim] { top: var(--bb-window-title-bar-height); border-radius: var(--studio-card-radius); }
${WORKBENCH} [data-sidebar-split-root-direction="row"] > [data-split-pane-id]:not([data-split-pane-id="pane-primary"]) > [data-pane-focus-scrim] { left: var(--fork-cards-gap, 10px); }
${WORKBENCH} [data-split-resize-grid-boundary]:not(:hover, [data-resize-handle-state="drag"]) { background: transparent; }
${SCROLLER_SELECTORS.join(", ")} { scrollbar-width: thin; scrollbar-color: transparent transparent; }
${SCROLLER_SELECTORS.map((each) => `${each}:hover`).join(", ")} { scrollbar-color: color-mix(in oklab, var(--ink) 35%, transparent) transparent; }
`;

export const HEADER_CSS = `
${GLASS} { --studio-title-row-glass: color-mix(in oklab, var(--canvas) 40%, transparent); }
${INSET} header { border-color: transparent; background: transparent; padding-inline: 0; --studio-title-width: var(--fork-cards-column, 808px); --studio-title-inset: var(--fork-cards-page-lead, 40px); }
${INSET} header:has(+ [data-thread-window]) { --studio-title-width: 760px; --studio-title-inset: 24px; }
${INSET} header:has(~ * [data-resource-collection-viewport]) { --studio-title-width: 64rem; --studio-title-inset: 1.25rem; }
${INSET} header:has(~ [data-pane-content]) { --studio-title-width: 100%; --studio-title-inset: 20px; }
${PAGE_BAR_BOX} { --studio-title-width: 56rem; --studio-title-inset: 2rem; }
${HEADER_ROW} { padding-inline: 16px; }
${RESERVED_ROW} { padding-left: ${CONTROLS_END}; }
${HEADER_ROW} > :has(> [data-fork-header-group="actions"]), ${HEADER_ROW} > [data-fork-header-group="actions"] { margin-left: auto; }
${HEADER_ROW}[data-studio-bar-row]:has([data-studio-page-bar="column"]) [data-studio-bar-fill] { position: static; }
${TITLE_BOXES} { position: absolute; inset: 0; box-sizing: border-box; display: flex; align-items: center; width: 100%; max-width: var(--studio-title-width); height: auto; margin-inline: auto; padding-inline: var(--studio-title-inset); pointer-events: none; ${BAR_HALO} }
${TITLE_BOXES} > * { pointer-events: auto; }
${RESERVED_ROW} ${TITLE_BOXES} { padding-left: max(var(--studio-title-inset), calc(${CONTROLS_END} - max(0px, (100cqw - var(--studio-title-width)) / 2))); }
${TITLE_BOX} [data-fork-header-group="title"] { flex: 1; min-width: 0; max-width: none; padding: 0; align-items: center; ${BARE} }
${TITLE_BOX} [data-fork-thread-header-after], ${TITLE_BOX} [data-fork-thread-header-after] > .studio-root { flex: 1; }
${TITLE_BOX} [data-fork-header-group="title"] > span:last-child { margin-left: auto; }
${GLASS} [data-testid="edit-space-title-row"] { ${BAR_HALO} }
${GLASS} [data-testid="edit-space-pane"] [data-testid="theme-picker-actions"] { background: var(--studio-title-row-glass); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); border-top-color: transparent; }
${GLASS} :is([data-fork-header-group], [data-sidebar="trigger"]) { ${BARE} }
${GLASS} :is([data-fork-header-group="history"], [data-fork-header-group="actions"], [data-sidebar="trigger"]) { ${BAR_HALO} }
`;

export const PROMPT_CARDS = `${GLASS} [data-sidebar="inset"] :is([data-testid="approval-banner"], [data-testid="user-question-banner"], [data-testid="plugin-request-banner"], [data-testid="plan-review-banner"], section[aria-label="Queued messages"])`;
export const PROMPT_CARD_LINES = `${PROMPT_CARDS} :is([class~="border-b"], [class~="border-t"], [class~="border"]:not(button, input, textarea, [role="radio"], [role="checkbox"]))`;
export const TOAST_CARD = `${GLASS} .bb-app-toast > div`;
export const GLASS_CHIPS = `${GLASS} [data-sidebar="inset"] :is([data-promptbox-expanded-only] .rounded-full.border, .cursor-zoom-in.border, [data-testid="conversation-workers"] button)`;
export const STUDIO_RULE = `${GLASS} [data-studio-rule]`;
export const DIFF_HOST = "diffs-container";
export const GLASS_DIFF_CARD = `${GLASS} :is(.rounded-lg, .rounded-md)[class~="border"]:has(${DIFF_HOST})`;
export const CLASSIC_FOOTER = `${ON}:not([${GLASS_ATTRIBUTE}]) [data-sidebar="inset"] [data-scroll-footer] > div`;

export const CHROME_CSS = `
[data-thread-header-responsive-action]:has(button[aria-label^="Open workspace in"]) { display: none; }
${GLASS} [role="separator"][data-resize-handle]:not([data-resize-handle-state="drag"]):not(:hover) > span { background: transparent; }
${GLASS} aside[data-surface-tone] [class*="has([data-info-section]))>&]:border-b"] { border-bottom-width: 0; }
${GLASS} [data-sidebar="inset"] [data-canvas-page] { border-radius: 0 0 var(--studio-card-radius) var(--studio-card-radius); }
${GLASS} [data-sidebar="content"][data-studio-own-scroll] { overflow: hidden; scrollbar-gutter: auto; }
${GLASS} .prompt-mention-pill { border-color: transparent; background-color: color-mix(in oklab, var(--ink) 14%, transparent); }
${RULES} { border-top-color: transparent; border-bottom-color: transparent; border-left-color: transparent; border-right-color: transparent; }
${PROMPT_CARDS}, ${PROMPT_CARD_LINES}, ${STUDIO_RULE} { border-color: transparent; }
${GLASS_CHIPS} { border-color: transparent; background-color: color-mix(in oklab, var(--ink) 14%, transparent); }
${GLASS_CHIPS}:hover { background-color: color-mix(in oklab, var(--ink) 20%, transparent); }
${CLASSIC_FOOTER} { background: var(--canvas); }
${ON} ${DIFF_HOST} { --diffs-dark-bg: var(--canvas); --diffs-light-bg: var(--canvas); }
${GLASS} ${DIFF_HOST} { --diffs-dark-bg: transparent; --diffs-light-bg: transparent; --fork-diffs-gutter-bg: var(--studio-diff-gutter); }
${GLASS} aside[data-surface-tone] ${DIFF_HOST} { --fork-diffs-gutter-bg: var(--studio-diff-gutter-panel); }
${GLASS_DIFF_CARD} { border-color: transparent; background: var(--fork-panel); }
${TOAST_CARD} { border-color: transparent; border-radius: var(--studio-card-radius); background: var(--fork-popover, var(--studio-glass-hud)); -webkit-backdrop-filter: var(--fork-popover-filter, blur(12px)); backdrop-filter: var(--fork-popover-filter, blur(12px)); box-shadow: var(--fork-cards-shadow, none); }
${GLASS} :is(nav[data-sidebar-navigation-placement="rail"], [data-fork-header-group="history"], [data-fork-header-group="actions"], [data-sidebar="trigger"], ${TITLE_BOX}, ${WORKBENCH_STRIP}) :is(button, [data-tab-pill]), ${GLASS} [data-sidebar="trigger"] { color: color-mix(in oklab, var(--ink) 88%, transparent); }
`;

export const THEME_CSS = `${CHROME_CSS}${HEADER_CSS}${GUTTER_CSS}${TABLE_CSS}
${ON} ${HEADINGS} { font-family: var(--studio-font-heading); }
html[${HEADING_WEIGHT_ATTRIBUTE}] ${HEADINGS} { font-weight: var(--studio-font-heading-weight); }
${ON} ::selection { background: var(--studio-selection); }
${ON} [data-sidebar="inset"] :where([data-thread-window]) { font-family: var(--studio-font-transcript); }
[data-studio-scene] { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
[data-studio-scene] > [data-studio-scene-layer] { position: absolute; inset: 0; }
[data-studio-scene] canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
html[${EFFECTS_ATTRIBUTE}~="needs-you"] [data-testid="conversation-row"][data-needs-you] { box-shadow: inset 0 0 0 1px var(--studio-needs-you), 0 0 16px color-mix(in oklab, var(--studio-needs-you) 30%, transparent); animation: studio-needs-you 2.4s ease-in-out infinite; }
html[${STILL_ATTRIBUTE}] [data-testid="conversation-row"][data-needs-you] { animation: none; }
@keyframes studio-needs-you { 50% { box-shadow: inset 0 0 0 1px var(--studio-needs-you), 0 0 26px color-mix(in oklab, var(--studio-needs-you) 55%, transparent); } }
@media (prefers-reduced-motion: reduce) { html[${EFFECTS_ATTRIBUTE}] [data-testid="conversation-row"][data-needs-you] { animation: none; } }
${LIST_PAGE} { position: relative; isolation: isolate; margin-bottom: -1.25rem; }
${LIST_PAGE}::before { content: ""; position: absolute; z-index: -1; inset: 0; width: min(100%, var(--fork-cards-wide-column, 1032px)); margin-inline: auto; pointer-events: none; ${cardOf("transcript")} }
${LIST_PAGE} .md\\:pr-3 { padding-right: 0; }
${BACKING_SELECTORS.pages} header ~ [data-pane-content] { ${cardOf("transcript")} overflow: hidden; }
${PAGE_ROOTS} { background: transparent; }
${PILL_SELECTOR} { background-color: var(--pill-surface, var(--surface-recessed)); }
${PILL_SELECTOR}:hover { background-color: var(--state-hover); }
${PILL_SELECTOR}[data-state="on"] { background-color: var(--pill-surface-selected, var(--state-active)); }
${BACKING_SELECTORS.composerReplace} { ${cardOf("composer")} padding: 8px 12px; }
${BACKING_SELECTORS.threadBanner} { background: var(--studio-glass-transcript); align-self: center; width: min(100%, var(--fork-cards-column, 100%)); border-radius: var(--studio-card-radius); }
${BACKING_SELECTORS.composerControls} { border-color: transparent; background-color: color-mix(in oklab, var(--ink) 10%, transparent); }
${BACKING_SELECTORS.composerControls}:hover { background-color: color-mix(in oklab, var(--ink) 18%, transparent); }
${Object.values(HALO_SELECTORS).join(", ")} { text-shadow: var(--studio-halo); }
`;
