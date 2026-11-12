import { CHECK_SIZES, evaluateMeasurement, LIGHT_CHECK_SIZE, type CheckLine, type Measurement, type RenderSample } from "./checks";
import { AMBER, PRESENCE_STATES, STATE_SPEED, type PresenceStateName } from "./forms";
import { CHECK_PALETTE, DEFAULT_PALETTE_LIGHT, paletteHex } from "./palette";
import { PresenceSandbox, type SandboxFrame, type SandboxTiming } from "./sandbox";

export const MEASURE_T = 3;
export const MEASURE_FRAMES = 24;
export const MEASURE_TIMEOUT_MS = 12_000;

export function tickFor(state: PresenceStateName, size: number, t: number, read: boolean, compared = false, light = false) {
  return {
    size, dpr: 1, t: compared ? t : t * STATE_SPEED[state], read,
    state: { name: state, workers: state === "working" ? 2 : 0, clock: t },
    palette: paletteHex(light ? DEFAULT_PALETTE_LIGHT : state === "needs" && !compared ? AMBER : CHECK_PALETTE),
  };
}

export function collectMeasurement(code: string, doc: Document, options: { timing?: SandboxTiming; timeoutMs?: number } = {}): Promise<Measurement> {
  return new Promise((resolve) => {
    const samples: RenderSample[] = [];
    const light: RenderSample[] = [];
    const frameMs: number[] = [];
    let repeat: RenderSample | null = null, later: RenderSample | null = null, done = false;
    type Step = { state: PresenceStateName; size: number; t: number; keep: "sample" | "light" | "repeat" | "later" | "time" };
    const steps: Step[] = [];
    for (const size of CHECK_SIZES) for (const state of PRESENCE_STATES) steps.push({ state, size, t: MEASURE_T, keep: "sample" });
    for (const state of PRESENCE_STATES) steps.push({ state, size: LIGHT_CHECK_SIZE, t: MEASURE_T, keep: "light" });
    steps.push({ state: "idle", size: 160, t: MEASURE_T, keep: "repeat" }, { state: "idle", size: 160, t: MEASURE_T + 1.5, keep: "later" });
    for (let i = 0; i < MEASURE_FRAMES; i++) steps.push({ state: i % 2 ? "thinking" : "working", size: 160, t: MEASURE_T + i / 30, keep: "time" });
    let index = 0;
    const holder = doc.createElement("div");
    holder.style.cssText = "position:fixed;left:-400px;top:0;width:160px;height:160px;opacity:0;pointer-events:none";
    const finish = (failure: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(limit);
      sandbox.dispose();
      holder.remove();
      resolve({ failure, samples, light, repeat, later, frameMs });
    };
    const next = () => {
      const step = steps[index];
      if (!step) { finish(null); return; }
      if (!sandbox.tick(tickFor(step.state, step.size, step.t, step.keep !== "time", step.keep !== "time", step.keep === "light"))) finish("The sandbox stopped answering.");
    };
    const onFrame = (frame: SandboxFrame) => {
      const step = steps[index++]!;
      if (step.keep === "time") frameMs.push(frame.ms);
      else if (!frame.pixels || frame.width !== step.size || frame.height !== step.size) { finish(`The ${step.size} px frame came back at the wrong size.`); return; }
      else {
        const sample: RenderSample = { size: step.size, state: step.state, t: step.t, width: frame.width, height: frame.height!, pixels: frame.pixels };
        if (step.keep === "sample") samples.push(sample); else if (step.keep === "light") light.push(sample); else if (step.keep === "repeat") repeat = sample; else later = sample;
      }
      next();
    };
    const sandbox = new PresenceSandbox({ code, document: doc, onFail: (reason) => finish(reason), onReady: next, onFrame, ...(options.timing ? { timing: options.timing } : {}) });
    const limit = setTimeout(() => finish("The checks took too long."), options.timeoutMs ?? MEASURE_TIMEOUT_MS);
    holder.append(sandbox.frame);
    doc.body.append(holder);
  });
}

export async function measurePresence(code: string, doc: Document): Promise<CheckLine[]> {
  return evaluateMeasurement(await collectMeasurement(code, doc));
}
