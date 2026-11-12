import type { SceneDriver } from "../scene/live";
import { REEF_SIZE } from "./atlas";
import { paintDeepSea, type ReefContext } from "./paint";

export interface ReefCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): ReefContext | null;
}

export interface DeepSeaDriverDeps {
  createCanvas(): ReefCanvas | null;
}

export const browserDeepSeaDeps: DeepSeaDriverDeps = {
  createCanvas: () => (typeof document === "undefined" ? null : document.createElement("canvas") as unknown as ReefCanvas),
};

export function deepSeaDriver(deps: DeepSeaDriverDeps = browserDeepSeaDeps): SceneDriver {
  return (publish) => {
    const canvas = deps.createCanvas();
    const context = canvas?.getContext("2d") ?? null;
    if (!canvas || !context) {
      publish({ u_reef: 0 });
      return () => {};
    }
    canvas.width = REEF_SIZE;
    canvas.height = REEF_SIZE;
    paintDeepSea(context);
    publish({ u_reef: 1 }, { source: canvas as unknown as TexImageSource, version: 1 });
    return () => {};
  };
}
