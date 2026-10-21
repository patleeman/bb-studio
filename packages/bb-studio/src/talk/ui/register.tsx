// Talk's frontend, registered by Studio's app.tsx (Talk is built into Studio).
//
// - An app-wide overlay owns the recorder (controller.ts) and shows the
//   recording pill on every page.
// - A content script hands presses on the composer's microphone to Talk, and
//   lets other plugins' fields ask for dictation (fields.ts).
// - Another watches the hold-to-talk key (hold-to-talk.ts).
// - Each recording's page is a Studio tab (route.tsx, loaded on demand); the
//   list is Studio's library filtered to recordings.
// - `::recording{id="rec_…"}` in a reply shows the recording inline.
//
// The ids are the ones the Talk plugin registered, now under Studio, so
// commands are `studio` commands: a keybinding set on Talk's command has to be
// set again (docs/merging-add-ons.md).
import { openAppPath } from "../../kit/app/index";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { interceptBuiltInMic, findComposer } from "./composer-dom";
import { talk } from "./controller";
import { TOGGLE_EVENT, clearStatus, fieldAt, publishStatus } from "./fields";
import { watchHoldToTalk } from "./hold-to-talk";
import { TalkOverlay } from "./overlay";
import { ComposerBridge } from "./ComposerBridge";
import { linkRecordingMentions } from "./recording-mentions";
import { RecordingCard } from "./recording-card";
import { ModelSettings } from "./model-settings";

export function registerTalkApp(app: PluginAppBuilder): void {
  app.slots.settingsSection({ id: "models", title: "Talk models", component: ModelSettings });
  app.contentScripts.register({
    id: "recording-links",
    mount({ signal }) { linkRecordingMentions(openAppPath, signal); },
  });
  app.composer.customize({
    id: "recording-references",
    banners: [{ id: "bridge", chrome: "bare", component: ComposerBridge }],
  });
  app.slots.messageDirective({ id: "recording", component: RecordingCard });
  app.slots.experimental_appOverlay({ id: "recorder", component: TalkOverlay });

  app.contentScripts.register({
    id: "composer-mic",
    mount({ signal, experimental_setThreadRowStatus }) {
      interceptBuiltInMic(
        {
          enabled: () => talk.replaceBuiltIn,
          stateFor: (promptbox) => talk.micState(promptbox),
          onPress: (promptbox) => void talk.toggleDictation(promptbox, { ordinary: true }),
          subscribe: talk.subscribe,
        },
        signal,
      );
      // Mark the thread Talk is dictating into, and threads with a finished
      // dictation waiting to be typed in.
      if (experimental_setThreadRowStatus) talk.decorateThreadRows(experimental_setThreadRowStatus, signal);
    },
  });

  app.contentScripts.register({
    id: "dictation-fields",
    mount({ signal }) {
      const publish = () => {
        const { status, field, phase } = talk.status();
        publishStatus(status, field, phase);
      };
      publish();
      const unsubscribe = talk.subscribe(publish);
      const onToggle = (event: Event) => {
        const found = fieldAt(event.target);
        if (found) void talk.toggleFieldDictation(found.field);
      };
      document.addEventListener(TOGGLE_EVENT, onToggle);
      signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          document.removeEventListener(TOGGLE_EVENT, onToggle);
          clearStatus();
        },
        { once: true },
      );
    },
  });

  // Hold the configured key to dictate into the focused composer or field.
  app.contentScripts.register({
    id: "hold-to-talk",
    mount({ signal }) {
      // A release can come before the start has claimed the microphone lock.
      let starting: Promise<void> = Promise.resolve();
      watchHoldToTalk(
        {
          code: () => talk.holdKey,
          start: () => {
            if (talk.isActive()) return false;
            const field = fieldAt(document.activeElement);
            starting = (field ? talk.toggleFieldDictation(field.field) : talk.toggleDictation(findComposer())).catch(() => {});
            return true;
          },
          finish: () => {
            void starting.then(() => (talk.isDictating() ? talk.stop(true) : undefined));
          },
        },
        signal,
      );
    },
  });

  app.commands.register({
    id: "toggle-dictation",
    title: "Talk: Start or finish dictation",
    // From the palette, finishing works from anywhere; the text waits for
    // its thread when that thread is not open.
    run: () => {
      if (talk.isDictating()) return talk.stop(true);
      const field = fieldAt(document.activeElement);
      return field ? talk.toggleFieldDictation(field.field) : talk.toggleDictation(findComposer());
    },
  });
  app.commands.register({
    id: "toggle-recording",
    title: "Talk: Start or stop a recording",
    run: () => (talk.isActive() ? talk.stop() : talk.startRecording("recording")),
  });
  app.commands.register({
    id: "pause-recording",
    title: "Talk: Pause or resume",
    isAvailable: () => talk.isActive(),
    run: () => (talk.getState().phase === "recording" ? talk.pause() : talk.resume()),
  });
}
