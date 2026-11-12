/** The README capture entry modules, in capture order. Other files in captures/ are helpers. */
import bb_studio_draw from "./captures/bb-studio-draw.mjs";
import bb_studio_whiteboards from "./captures/bb-studio-whiteboards.mjs";
import bb_studio_dashboards from "./captures/bb-studio-dashboards.mjs";
import bb_studio_visual_chat from "./captures/bb-studio-visual-chat.mjs";
import bb_studio_minis from "./captures/bb-studio-minis.mjs";
import bb_studio_talk from "./captures/bb-studio-talk.mjs";
import bb_studio_pages from "./captures/bb-studio-pages.mjs";
import bb_studio_notes from "./captures/bb-studio-notes.mjs";
import bb_studio from "./captures/bb-studio.mjs";
import bb_studio_bot_maintenance from "./captures/bb-studio-bot-maintenance.mjs";
import bb_studio_bot from "./captures/bb-studio-bot.mjs";
import bb_studio_bot_calendar from "./captures/bb-studio-bot-calendar.mjs";
import bb_studio_bot_redesign from "./captures/bb-studio-bot-redesign.mjs";
import bb_studio_bot_needs_you from "./captures/bb-studio-bot-needs-you.mjs";
import bb_studio_bot_row_status from "./captures/bb-studio-bot-row-status.mjs";
import bb_studio_bot_rail_removed from "./captures/bb-studio-bot-rail-removed.mjs";
import bb_studio_bot_threads from "./captures/bb-studio-bot-threads.mjs";
import bb_studio_loops from "./captures/bb-studio-loops.mjs";
import bb_studio_thread_resume from "./captures/bb-studio-thread-resume.mjs";
import bb_studio_artifacts from "./captures/bb-studio-artifacts.mjs";
import bb_studio_reactions from "./captures/bb-studio-reactions-settings.mjs";
import bb_studio_decisions from "./captures/bb-studio-decisions.mjs";
import bb_studio_mobile from "./captures/bb-studio-mobile.mjs";
import bb_studio_settings from "./captures/bb-studio-settings.mjs";
import design from "./captures/design.mjs";
import bb_studio_code from "./captures/bb-studio-code.mjs";
import compactHeaders from "./captures/compact-headers.mjs";
import bb_studio_stars from "./captures/bb-studio-stars.mjs";

export function loadCaptures(context) {
  return [
    ...(process.env.BB_CAPTURE_COMPACT_HEADERS === "1" ? compactHeaders(context) : []),
    ...bb_studio_draw(context),
    ...(process.env.BB_WHITEBOARDS_PHASE ? bb_studio_whiteboards(context) : []),
    ...bb_studio_dashboards(context),
    ...bb_studio_visual_chat(context),
    ...bb_studio_minis(context),
    ...bb_studio_talk(context),
    ...bb_studio_pages(context),
    ...bb_studio_notes(context),
    ...bb_studio(context),
    ...bb_studio_bot(context),
    ...bb_studio_bot_calendar(context),
    ...bb_studio_bot_redesign(context),
    ...bb_studio_bot_needs_you(context),
    ...bb_studio_bot_row_status(context),
    ...bb_studio_bot_rail_removed(context),
    ...(process.env.BB_BOT_THREADS_PHASE ? bb_studio_bot_threads(context) : []),
    ...bb_studio_loops(context),
    ...bb_studio_bot_maintenance(context),
    ...bb_studio_thread_resume(context),
    ...bb_studio_artifacts(context),
    ...bb_studio_reactions(context),
    ...bb_studio_decisions(context),
    ...bb_studio_mobile(context),
    ...bb_studio_settings(context),
    ...design(context),
    ...bb_studio_code(context),
    ...(process.env.BB_STARS_PHASE ? bb_studio_stars(context) : []),
  ];
}
