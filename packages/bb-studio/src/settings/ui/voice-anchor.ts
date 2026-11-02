// "Voice settings…" in the waveform menu opens Studio's settings page on the
// Voice section: it sets this flag, and the section scrolls itself into view
// when it next mounts (sections.tsx).

/** Studio's settings page. */
export const STUDIO_SETTINGS_PATH = "/settings/plugins/studio";
/** The Voice section's anchor. */
export const VOICE_SECTION_ANCHOR = "studio-settings-voice";

let requested = false;

/** Asks the Voice section to scroll itself into view when it next mounts. */
export function requestVoiceSection(): void {
  requested = true;
}

/** Whether it was asked to, once: reading clears it. */
export function takeVoiceSectionRequest(): boolean {
  const was = requested;
  requested = false;
  return was;
}
