import { dataCityDriver } from "../data-city/driver";
import { deepSeaDriver } from "../deep-sea/driver";
import { forestDriver } from "../forest/driver";
import { gridDriver } from "../grid/driver";
import { kyotoDriver } from "../kyoto/driver";
import type { SceneDrivers } from "../scene/live";
import { tonightDriver } from "../tonight/driver";

export const BUILTIN_DRIVERS: SceneDrivers = { forest: forestDriver(), "kyoto-garden": kyotoDriver(), "tonights-sky": tonightDriver(), "data-city": dataCityDriver(), "deep-sea": deepSeaDriver(), grid: gridDriver() };
