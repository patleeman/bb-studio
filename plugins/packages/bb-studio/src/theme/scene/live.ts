import type { Mode, UniformValue } from "../schema";
import type { SceneInputs } from "./layout";

export type LiveUniforms = Readonly<Record<string, UniformValue>>;
export interface SceneLayer { source: TexImageSource; version: number }
export type ScenePublish = (uniforms: LiveUniforms, layer?: SceneLayer, mode?: Mode) => void;
export type SceneDriver = (publish: ScenePublish, scene?: SceneInputs) => () => void;
export type SceneDrivers = Readonly<Record<string, SceneDriver>>;
