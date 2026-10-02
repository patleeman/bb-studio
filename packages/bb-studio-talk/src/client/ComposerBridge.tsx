import { useComposer } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef } from "react";
import { COMPOSER_REFERENCE_EVENT } from "./composer-dom";
import { parseRecordingReference } from "./recording-reference";

/** Bind the SDK's mention API to this exact composer, including side chats. */
export function ComposerBridge() {
  const composer = useComposer();
  const marker = useRef<HTMLSpanElement>(null);
  const current = useRef(composer);
  current.current = composer;
  useEffect(() => {
    const shell = marker.current?.closest<HTMLElement>("[data-promptbox-shell]");
    if (!shell) return;
    const onReference = (event: Event) => {
      const recording = parseRecordingReference((event as CustomEvent<{ recording?: unknown }>).detail?.recording);
      if (!recording) return;
      current.current.insertMention({ provider: "recordings", id: recording.id, label: recording.title });
      event.preventDefault();
      event.stopPropagation();
    };
    shell.addEventListener(COMPOSER_REFERENCE_EVENT, onReference);
    return () => shell.removeEventListener(COMPOSER_REFERENCE_EVENT, onReference);
  }, []);
  return <span hidden ref={marker} data-talk-composer-bridge="" />;
}
