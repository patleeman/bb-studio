import { useComposer } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef } from "react";
import { COMPOSER_REFERENCE_EVENT } from "./composer-dom";
import { parseRecordingReference } from "./recording-reference";
import { registerComposerSource } from "./composer-source";

/** Bind the SDK's mention API to this exact composer, including side chats. */
export function ComposerBridge() {
  const composer = useComposer();
  const marker = useRef<HTMLSpanElement>(null);
  const current = useRef(composer);
  current.current = composer;
  useEffect(() => {
    const shell = marker.current?.closest<HTMLElement>("[data-promptbox-shell]");
    if (!shell) return;
    const promptbox = shell.querySelector<HTMLElement>("[data-promptbox]");
    const unregister = promptbox ? registerComposerSource(promptbox, () => current.current.scope) : () => {};
    const onReference = (event: Event) => {
      const recording = parseRecordingReference((event as CustomEvent<{ recording?: unknown }>).detail?.recording);
      if (!recording) return;
      current.current.insert({ provider: "recordings", id: recording.id, label: recording.title });
      event.preventDefault();
      event.stopPropagation();
    };
    shell.addEventListener(COMPOSER_REFERENCE_EVENT, onReference);
    return () => { unregister(); shell.removeEventListener(COMPOSER_REFERENCE_EVENT, onReference); };
  }, []);
  return <span hidden ref={marker} data-talk-composer-bridge="" />;
}
