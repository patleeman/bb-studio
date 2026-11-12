import type { SceneDriver } from "../scene/live";
import { ATLAS, paintAtlas, type AtlasContext } from "./atlas";

export interface AtlasCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): AtlasContext | null;
}

export interface DataCityDriverDeps {
  createCanvas(): AtlasCanvas | null;
}

export const browserDataCityDeps: DataCityDriverDeps = {
  createCanvas: () => (typeof document === "undefined" ? null : document.createElement("canvas") as unknown as AtlasCanvas),
};

export function dataCityDriver(deps: DataCityDriverDeps = browserDataCityDeps): SceneDriver {
  return (publish) => {
    const canvas = deps.createCanvas();
    const context = canvas?.getContext("2d") ?? null;
    if (!canvas || !context) {
      publish({ u_atlas: 0 });
      return () => {};
    }
    canvas.width = ATLAS.size;
    canvas.height = ATLAS.size;
    paintAtlas(context);
    publish({ u_atlas: 1 }, { source: canvas as unknown as TexImageSource, version: 1 });
    return () => {};
  };
}
