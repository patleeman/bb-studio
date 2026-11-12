// The HUD's look over BB's own chat (src/hud/ui/Hud.tsx). The window is
// see-through; ThreadChat (compact) is BB's transcript with BB's composer in
// a footer at the bottom of the same scroller. This style, scoped to the
// HUD's root, makes it a heads-up display:
// - every surface BB paints behind the transcript and the footer is see-through,
//   and its fades and the footer's chip row are gone;
// - the transcript fades out toward the top (a mask on the scroller, opaque
//   where the bar is), over macOS's blurred HUD material (the window's
//   vibrancy) and a light tint that is clear at the top and thickens toward
//   the bar ([data-hud-backdrop]), and its text carries a halo in the
//   theme's background colour, so it reads on any wallpaper; the halo fades
//   with the text;
// - BB's composer is one rounded bar: the editor, then the model, reasoning
//   and mode controls, the mic and send/stop, in one row (the controls wrap
//   onto a second line inside the bar when the window is narrow). Its right
//   end leaves room for the HUD's own buttons ([data-hud-bar-tools]), which
//   sit over it; with no bar on screen (a question or approval waiting,
//   a read-only thread) they move to the top right corner. The bar's empty
//   parts drag the window.
// It reads the data attributes of BB's thread view and of BB's composer
// plugin (plugins/composer): when one is renamed, the HUD keeps working and
// only looks more like BB's side panel.

/** Room at the bar's right end for the HUD's own buttons. */
export const HUD_TOOLS_WIDTH = 64;
/** The gap between the bar and the window's edges. */
export const HUD_BAR_INSET = 8;
/** The bar's one-line height (BB's compact composer is 3rem). */
export const HUD_BAR_HEIGHT = 48;

const ROOT = "[data-studio-hud]";
const HALO = "color-mix(in oklab, var(--background) 88%, transparent)";
const HALO_SOFT = "color-mix(in oklab, var(--background) 55%, transparent)";
const FADE = "linear-gradient(to bottom, transparent 0%, rgb(0 0 0 / 0.35) 22%, rgb(0 0 0 / 0.85) 48%, #000 62%)";

/** For the desktop app's see-through window only: in a browser popup the page keeps a background. */
export const HUD_PAGE_CSS = "html, body, #root { background: transparent !important; }";

export const HUD_CSS = `
${ROOT} [data-hud-backdrop] {
  background: linear-gradient(to bottom,
    transparent 0%,
    color-mix(in oklab, var(--background) 6%, transparent) 35%,
    color-mix(in oklab, var(--background) 20%, transparent) 70%,
    color-mix(in oklab, var(--background) var(--studio-hud-glass, 36%), transparent) 100%);
}
${ROOT} [data-thread-window],
${ROOT} [data-page-scroll-viewport],
${ROOT} [data-scroll-footer],
${ROOT} [data-scroll-footer] > div { background: transparent !important; }
${ROOT} [data-overflow-fade],
${ROOT} [data-testid="title-bar-scroll-fade"],
${ROOT} [data-follow-up-composer-footer] { display: none !important; }
${ROOT} [data-page-scroll-viewport] {
  -webkit-mask-image: ${FADE};
  mask-image: ${FADE};
  scrollbar-width: none;
}
${ROOT} [data-page-scroll-viewport]::-webkit-scrollbar { display: none; }
${ROOT} [data-page-scroll-viewport]:has([data-promptbox-typeahead-menu]) { -webkit-mask-image: none; mask-image: none; }
${ROOT} [data-page-scroll-viewport] > div > :not([data-scroll-footer]) {
  text-shadow: 0 0 1px ${HALO}, 0 1px 3px ${HALO}, 0 0 12px ${HALO_SOFT};
}
${ROOT} [data-scroll-footer] > div > div:not([data-overflow-fade]) {
  padding: 0 ${HUD_BAR_INSET}px ${HUD_BAR_INSET}px !important;
}
${ROOT} [data-promptbox] {
  border-radius: 16px;
  padding-right: ${HUD_TOOLS_WIDTH}px;
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.28), 0 1px 3px rgb(0 0 0 / 0.18);
  -webkit-app-region: drag;
}
${ROOT} [data-promptbox] :is(button, a, input, textarea, select, [contenteditable], [role="button"], [role="combobox"], [data-promptbox-input-region], [data-promptbox-typeahead-menu]) {
  -webkit-app-region: no-drag;
}
${ROOT} [data-promptbox]:not([data-promptbox-compact]) [data-promptbox-main] {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
}
${ROOT} [data-promptbox]:not([data-promptbox-compact]) [data-promptbox-main] > [data-promptbox-expanded-only] {
  order: -1;
  flex-basis: 100%;
}
${ROOT} [data-promptbox]:not([data-promptbox-compact]) [data-promptbox-main] > [data-promptbox-expanded-only]:empty { display: none; }
${ROOT} [data-promptbox]:not([data-promptbox-compact]) [data-promptbox-input-region] {
  flex: 1 1 12rem;
  min-width: 0;
}
${ROOT} [data-promptbox-input-region] > [data-promptbox-expanded-only] { display: none !important; }
${ROOT} [data-promptbox]:not([data-promptbox-compact]) [data-promptbox-editor-scroll] {
  min-height: ${HUD_BAR_HEIGHT}px !important;
  padding: 12px 8px 10px 14px !important;
}
${ROOT} [data-promptbox]:not([data-promptbox-compact]) [data-promptbox-action-row] {
  flex: 0 1 auto;
  flex-wrap: nowrap;
  min-height: ${HUD_BAR_HEIGHT}px;
  margin-left: auto;
  padding: 0 4px 0 0;
  gap: 4px;
}
${ROOT} [data-promptbox]:not([data-promptbox-compact]) [data-promptbox-action-row] > [data-promptbox-standard-actions] { flex: 0 1 auto; min-width: 0; }
${ROOT} [data-testid="hud-empty"] { -webkit-app-region: drag; }
${ROOT} [data-hud-bar-tools] {
  right: ${HUD_BAR_INSET + 6}px;
  bottom: ${HUD_BAR_INSET + (HUD_BAR_HEIGHT - 26) / 2}px;
  -webkit-app-region: no-drag;
}
${ROOT}[data-hud-thread]:not(:has([data-follow-up-composer]:not([hidden]) [data-promptbox])) [data-hud-bar-tools] {
  top: ${HUD_BAR_INSET}px;
  bottom: auto;
}
`;
