import type { KyotoUniforms } from "./scene";

export const ATLAS_SIZE = 2048;
export const ATLAS_SCALE = 800;

export interface Tile { x: number; y: number; width: number; height: number }

export const TILES = {
  dist: { x: 0, y: 0, width: 2048, height: 288 },
  mid: { x: 0, y: 288, width: 2048, height: 304 },
  ground: { x: 0, y: 592, width: 2048, height: 304 },
  maple: { x: 0, y: 896, width: 1152, height: 512 },
  bamboo: { x: 1152, y: 896, width: 448, height: 512 },
  sprites: { x: 1616, y: 912, width: 256, height: 128 },
  stone: { x: 1616, y: 1056, width: 192, height: 80 },
  shoji: { x: 1952, y: 896, width: 96, height: 1000 },
  pond: { x: 0, y: 1408, width: 1152, height: 304 },
  mask: { x: 1152, y: 1408, width: 576, height: 152 },
  clouds: { x: 0, y: 1712, width: 1024, height: 256 },
  deck: { x: 1024, y: 1712, width: 512, height: 128 },
  marker: { x: 2032, y: 2032, width: 16, height: 16 },
} as const satisfies Record<string, Tile>;

export type TileName = keyof typeof TILES;

export const WORLD = {
  anchor: 0.9,
  span: 2.56,
  distBase: 0.44,
  midBase: 0.41,
  groundBase: 0.07,
  mapleLeft: 1,
  mapleBase: 0.38,
  bambooLeft: 0.06,
  bambooBase: 0.42,
  trunk: 0.065,
  lantern: -0.052,
  pond: -0.34,
  pondY: 0.265,
  pondRadius: [0.52, 0.11],
  pine: 0.34,
  pagoda: -0.118,
} as const;

export function tileVec(name: TileName): string {
  const tile = TILES[name];
  const part = (value: number) => (value / ATLAS_SIZE).toFixed(5);
  return `vec4(${part(tile.x)}, ${part(tile.y)}, ${part(tile.width)}, ${part(tile.height)})`;
}

export interface GardenSpec { spring: number; summer: number; autumn: number; winter: number; snow: number; low: number }

const tenth = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10) / 10;

export function gardenSpec(uniforms: KyotoUniforms): GardenSpec {
  const [spring, summer, autumn, winter] = uniforms.u_season;
  return {
    spring: tenth(spring),
    summer: tenth(summer),
    autumn: tenth(autumn),
    winter: tenth(winter),
    snow: tenth(Math.max(winter * 0.9, uniforms.u_weather[2])),
    low: Math.round(uniforms.u_sky[1] * uniforms.u_sky[0] * 2) / 2,
  };
}

export function specKey(spec: GardenSpec): string {
  return [spec.spring, spec.summer, spec.autumn, spec.winter, spec.snow, spec.low].join("/");
}
