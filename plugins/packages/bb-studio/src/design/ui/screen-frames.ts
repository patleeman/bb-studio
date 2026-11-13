import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { errorMessage } from "../../kit/format";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { frameSize, type DesignView } from "../shared";
import type { CanvasApi } from "./canvas";
import { createEditGate } from "./edit-gate";

type ScreenMessage =
  | { type: "ready" }
  | { type: "wheel"; deltaX: number; deltaY: number; zoom: boolean; x: number; y: number }
  | { type: "space"; down: boolean }
  | { type: "edit-start"; before: string }
  | { type: "text"; before: string; text: string }
  | { type: "not-editable" };

/**
 * The frames of one board and edit mode. It also relays the gestures screens
 * hand back to the canvas.
 * Frames are keyed by `frameKey(screenId, step)`: a splayed prototype has one per step.
 */
export function useScreenFrames(design: DesignView, canvas: RefObject<CanvasApi | null>) {
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const rpc = useRpc<typeof rpcContract>();
  /** Edit mode: click text on a screen to type over it. */
  const [editing, setEditing] = useState(false);
  /** The edit the user started; a screen's script can't post one of its own. */
  const editGate = useRef(createEditGate());

  const send = useCallback((key: string, message: Record<string, unknown>) => {
    frames.current.get(key)?.contentWindow?.postMessage({ bbDesign: true, ...message }, "*");
  }, []);

  const register = useCallback((key: string) => (frame: HTMLIFrameElement | null) => {
    if (frame) frames.current.set(key, frame);
    else frames.current.delete(key);
  }, []);

  /** A frame's page box and its scale (frame pixels to page pixels). */
  const frameBox = useCallback((key: string) => {
    const frame = frames.current.get(key);
    const screen = design.rounds.flatMap((round) => round.screens).find((each) => each.id === key.split("#")[0]);
    if (!frame || !screen) return null;
    const box = frame.getBoundingClientRect();
    return { box, scale: box.width / frameSize(screen.viewport).width };
  }, [design.rounds]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as ({ bbDesign?: boolean } & ScreenMessage) | null;
      if (!data?.bbDesign) return;
      const key = [...frames.current].find(([, frame]) => frame.contentWindow === event.source)?.[0];
      if (!key) return;
      const [screenId = ""] = key.split("#");
      if (data.type === "ready") {
        send(key, { type: "mode", edit: editing });
      } else if (data.type === "wheel") {
        const frame = frameBox(key);
        if (!frame) return;
        // Deltas and the point are in screen pixels; the canvas works in page pixels.
        canvas.current?.wheel({
          deltaX: data.deltaX * (data.zoom ? 1 : frame.scale),
          deltaY: data.deltaY * (data.zoom ? 1 : frame.scale),
          zoom: data.zoom,
          clientX: frame.box.left + data.x * frame.scale,
          clientY: frame.box.top + data.y * frame.scale,
        });
      } else if (data.type === "space") {
        canvas.current?.setSpace(data.down);
      } else if (data.type === "edit-start") {
        // The user's click in the frame activates the canvas too; a script alone can't.
        editGate.current.start(key, data.before, { editing, activated: navigator.userActivation?.isActive ?? false });
      } else if (data.type === "text") {
        if (!editGate.current.take(key, data.before, editing)) return;
        rpc.call("designs.editText", { designId: design.id, screenId, before: data.before, after: data.text })
          .then((result) => {
            if (result.ok) return;
            // The live text no longer matches the source exactly once; reload the frame to undo the typing.
            toast.error({
              ambiguous: "That text appears more than once in the screen.",
              missing: "Couldn't find that text in the screen's source.",
              markup: "Only text and simple formatting can be edited here.",
            }[result.reason ?? "missing"]);
            const frame = frames.current.get(key);
            if (frame) frame.src = frame.src;
          })
          .catch((error) => toast.error(errorMessage(error)));
      } else if (data.type === "not-editable") {
        toast.info("Only text can be edited here.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [canvas, design.id, editing, frameBox, rpc, send]);

  // Every screen follows the mode.
  useEffect(() => {
    for (const key of frames.current.keys()) send(key, { type: "mode", edit: editing });
    if (!editing) editGate.current.reset();
  }, [editing, send]);

  return { editing, setEditing, register };
}
