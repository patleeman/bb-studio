/** The README capture entry modules, in capture order. Other files in captures/ are helpers. */
import bb_studio_sidebar from "./captures/bb-studio-sidebar.mjs";
import studioCommand from "./captures/studio-command.mjs";
import bb_studio_draw from "./captures/bb-studio-draw.mjs";
import bb_studio_chat from "./captures/bb-studio-chat.mjs";
import bb_studio_talk from "./captures/bb-studio-talk.mjs";
import bb_studio_pages from "./captures/bb-studio-pages.mjs";
import bb_studio from "./captures/bb-studio.mjs";
import bb_studio_artifacts from "./captures/bb-studio-artifacts.mjs";
import bb_studio_reactions from "./captures/bb-studio-reactions.mjs";
import bb_studio_decisions from "./captures/bb-studio-decisions.mjs";
import bb_studio_mobile from "./captures/bb-studio-mobile.mjs";
import bb_studio_tables from "./captures/bb-studio-tables.mjs";
import design from "./captures/design.mjs";
import bb_studio_code from "./captures/bb-studio-code.mjs";
import sidebar_navigation from "./captures/sidebar-navigation.mjs";
import compactHeaders from "./captures/compact-headers.mjs";

export function loadCaptures(context) {
  return [
    ...(process.env.BB_CAPTURE_COMPACT_HEADERS === "1" ? compactHeaders(context) : []),
    ...bb_studio_sidebar(context),
    ...studioCommand(context),
    ...bb_studio_draw(context),
    ...bb_studio_chat(context),
    ...bb_studio_talk(context),
    ...bb_studio_pages(context),
    ...bb_studio(context),
    ...bb_studio_artifacts(context),
    ...bb_studio_reactions(context),
    ...bb_studio_decisions(context),
    ...bb_studio_mobile(context),
    ...bb_studio_tables(context),
    ...design(context),
    ...bb_studio_code(context),
    ...sidebar_navigation(context),
  ];
}
