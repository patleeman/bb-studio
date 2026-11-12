import type { SceneDriver } from "../scene/live";
import { CITY_SIZE } from "./atlas";
import { paintCity, type CityContext } from "./paint";

export interface CityCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): CityContext | null;
}

export interface GridDriverDeps {
  createCanvas(): CityCanvas | null;
}

export const browserGridDeps: GridDriverDeps = {
  createCanvas: () => (typeof document === "undefined" ? null : document.createElement("canvas") as unknown as CityCanvas),
};

export function gridDriver(deps: GridDriverDeps = browserGridDeps): SceneDriver {
  return (publish) => {
    const canvas = deps.createCanvas();
    const context = canvas?.getContext("2d") ?? null;
    if (!canvas || !context) {
      publish({ u_city: 0 });
      return () => {};
    }
    canvas.width = CITY_SIZE;
    canvas.height = CITY_SIZE;
    paintCity(context);
    publish({ u_city: 1 }, { source: canvas as unknown as TexImageSource, version: 1 });
    return () => {};
  };
}
