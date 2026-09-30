// bb-plugin-talk frontend.
//
// - An app-wide overlay owns the recorder (src/client/controller.ts) and shows
//   the recording pill on every page.
// - A content script hands presses on the composer's microphone to Talk, and
//   lets other plugins' fields ask for dictation (src/client/fields.ts).
// - The Recordings nav panel lists recordings and is each recording's page.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { PANEL_PATH, TALK_ICON } from "./src/shared/format";
import { interceptBuiltInMic, findComposer } from "./src/client/composer-dom";
import { talk } from "./src/client/controller";
import { TOGGLE_EVENT, clearStatus, fieldAt, publishStatus } from "./src/client/fields";
import { TalkOverlay } from "./src/client/overlay";
import { RecordingsPanel } from "./src/client/recordings-panel";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "recordings",
    title: "Recordings",
    icon: TALK_ICON,
    path: PANEL_PATH,
    component: RecordingsPanel,
  });

  app.slots.experimental_appOverlay({ id: "recorder", component: TalkOverlay });

  app.contentScripts.register({
    id: "composer-mic",
    mount({ signal, experimental_setThreadRowStatus }) {
      interceptBuiltInMic(
        {
          enabled: () => talk.replaceBuiltIn,
          stateFor: (promptbox) => talk.micState(promptbox),
          onPress: (promptbox) => void talk.toggleDictation(promptbox),
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
});
