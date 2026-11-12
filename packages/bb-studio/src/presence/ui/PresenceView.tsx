import { useEffect, useRef } from "react";
import type { PresenceEntryView } from "../contract";
import { AMBER, AMBER_LIGHT, drawPresence, isBuiltinForm, STATE_SPEED, type BuiltinForm, type Palette, type PresenceStateName } from "../forms";
import { applyHalo, haloFilter } from "../halo";
import { sharedLoop } from "../loop";
import { paletteHex } from "../palette";
import { PresenceSandbox } from "../sandbox";
import { FALLBACK_FORM } from "../schema";
import { useAppMode } from "../../ui/conversations/app-mode";
import { failureKey, markPresenceFailed, presenceFailure, usePresenceVersion } from "./state";

export interface PresenceViewProps {
  form: string;
  custom?: PresenceEntryView | null;
  palette: Palette;
  light: boolean;
  state: PresenceStateName;
  workers: number;
  motion: number;
  size: number;
  still?: boolean;
}

type ShownProps = Omit<PresenceViewProps, "custom" | "form"> & { surfaceLight: boolean };

const START_TIME = 5.5;
const CUSTOM_STEP = 1 / 31;

function watchSeen(element: Element, set: (seen: boolean) => void): () => void {
  if (typeof IntersectionObserver !== "function") return () => {};
  const observer = new IntersectionObserver((entries) => { const last = entries[entries.length - 1]; if (last) set(last.isIntersecting); });
  observer.observe(element);
  return () => observer.disconnect();
}

export function canDraw(): boolean {
  return typeof window !== "undefined" && typeof window.CanvasRenderingContext2D === "function" && typeof window.requestAnimationFrame === "function";
}

function BuiltinPresence(props: ShownProps & { form: BuiltinForm }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;
  const paint = useRef<() => void>(() => {});
  useEffect(() => {
    const element = canvas.current;
    if (!element || !canDraw()) return;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    element.width = Math.round(props.size * dpr);
    element.height = Math.round(props.size * dpr);
    const clock = { real: 0, form: START_TIME };
    let seen = true;
    const draw = () => {
      const now = live.current;
      drawPresence(ctx, { form: now.form, size: now.size, dpr, clock: clock.real, formTime: clock.form, state: now.state, workers: now.workers, palette: now.palette, light: now.light });
      applyHalo(element, haloFilter({ surfaceLight: now.surfaceLight, state: now.state, size: now.size, clock: clock.real, palette: now.palette }));
    };
    paint.current = draw;
    draw();
    if (props.still) return () => { paint.current = () => {}; };
    const unseen = watchSeen(element, (next) => { seen = next; });
    const remove = sharedLoop().add({
      visible: () => seen,
      frame: (dt) => { clock.real += dt; clock.form += dt * STATE_SPEED[live.current.state] * live.current.motion; draw(); },
      still: draw,
    });
    return () => { remove(); unseen(); paint.current = () => {}; };
  }, [props.size, props.still]);
  useEffect(() => { paint.current(); }, [props.form, props.state, props.workers, props.palette, props.light, props.motion, props.surfaceLight]);
  return <canvas ref={canvas} aria-hidden data-presence-canvas="" style={{ width: props.size, height: props.size, display: "block" }} />;
}

function SandboxedPresence(props: ShownProps & { code: string; onFail(reason: string): void }) {
  const holder = useRef<HTMLSpanElement>(null);
  const live = useRef(props);
  live.current = props;
  const paint = useRef<() => void>(() => {});
  useEffect(() => {
    const element = holder.current;
    if (!element || !canDraw()) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const clock = { real: 0, form: START_TIME, due: 0 };
    let seen = true;
    const tick = () => {
      const now = live.current;
      sandbox.tick({
        size: now.size, dpr, t: clock.form,
        state: { name: now.state, workers: now.workers, clock: clock.real },
        palette: paletteHex(now.state === "needs" ? (now.light ? AMBER_LIGHT : AMBER) : now.palette),
      });
      applyHalo(element, haloFilter({ surfaceLight: now.surfaceLight, state: now.state, size: now.size, clock: clock.real, palette: now.palette }));
    };
    const sandbox = new PresenceSandbox({ code: props.code, document, onFail: (reason) => live.current.onFail(reason), onReady: tick });
    element.append(sandbox.frame);
    paint.current = tick;
    const unseen = watchSeen(element, (next) => { seen = next; });
    const remove = sharedLoop().add({
      visible: () => seen,
      frame: (dt) => {
        clock.real += dt;
        clock.form += dt * STATE_SPEED[live.current.state] * live.current.motion;
        clock.due += dt;
        if (clock.due < CUSTOM_STEP) return;
        clock.due = 0;
        tick();
      },
      still: tick,
    });
    return () => { remove(); unseen(); paint.current = () => {}; sandbox.dispose(); };
  }, [props.code, props.size]);
  useEffect(() => { paint.current(); }, [props.state, props.workers, props.palette, props.light, props.motion, props.surfaceLight]);
  return <span ref={holder} aria-hidden data-presence-custom="" style={{ width: props.size, height: props.size, display: "block", colorScheme: "light dark" }} />;
}

const STILL_CACHE_SIZE = 48;
const stills = new Map<string, ImageData>();

function StillCustom(props: Omit<ShownProps, "still"> & { code: string; cacheKey: string; onFail(reason: string): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const failed = useRef(props.onFail);
  failed.current = props.onFail;
  const colors = paletteHex(props.state === "needs" ? (props.light ? AMBER_LIGHT : AMBER) : props.palette);
  const dpr = canDraw() ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const key = `${props.cacheKey}|${props.size}|${dpr}|${props.state}|${props.workers}|${colors.join("")}`;
  useEffect(() => {
    const element = canvas.current;
    if (!element || !canDraw()) return;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    const show = (image: ImageData) => { element.width = image.width; element.height = image.height; ctx.putImageData(image, 0, 0); };
    const kept = stills.get(key);
    if (kept) { show(kept); return; }
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-400px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    const done = () => { sandbox.dispose(); holder.remove(); };
    const sandbox = new PresenceSandbox({
      code: props.code, document,
      onFail: (reason) => { holder.remove(); failed.current(reason); },
      onReady: () => { sandbox.tick({ size: props.size, dpr, t: START_TIME, state: { name: props.state, workers: props.workers, clock: 0 }, palette: colors, read: true }); },
      onFrame: (frame) => {
        if (frame.pixels && frame.width && frame.height) {
          const image = new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height);
          if (stills.size >= STILL_CACHE_SIZE) stills.delete(stills.keys().next().value!);
          stills.set(key, image);
          show(image);
        }
        done();
      },
    });
    holder.append(sandbox.frame);
    document.body.append(holder);
    return done;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const halo = haloFilter({ surfaceLight: props.surfaceLight, state: props.state, size: props.size, clock: 0, palette: props.palette });
  return <canvas ref={canvas} aria-hidden data-presence-canvas="" data-presence-still="" style={{ width: props.size, height: props.size, display: "block", ...(halo === "none" ? {} : { filter: halo }) }} />;
}

export function PresenceView({ custom = null, form, ...props }: PresenceViewProps) {
  usePresenceVersion();
  const rest = { ...props, surfaceLight: useAppMode() === "light" };
  const key = custom?.code ? failureKey(custom) : null;
  if (custom?.code && key && !presenceFailure(key) && rest.still) return <StillCustom {...rest} code={custom.code} cacheKey={key} onFail={(reason) => markPresenceFailed(key, reason)} />;
  if (custom?.code && key && !presenceFailure(key)) return <SandboxedPresence {...rest} code={custom.code} onFail={(reason) => markPresenceFailed(key, reason)} />;
  return <BuiltinPresence {...rest} form={isBuiltinForm(form) ? form : FALLBACK_FORM} />;
}
