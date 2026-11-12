export const CITY_SIZE = 2048;

export interface CityBox { x: number; y: number; width: number; height: number }

export const CITY_BOXES = {
  far: { x: 0, y: 0, width: 2048, height: 256 },
  mid: { x: 0, y: 256, width: 2048, height: 384 },
  near: { x: 0, y: 640, width: 2048, height: 640 },
  ring: { x: 0, y: 1280, width: 768, height: 768 },
  bike: { x: 768, y: 1280, width: 512, height: 192 },
} as const satisfies Record<string, CityBox>;

export type CityBoxName = keyof typeof CITY_BOXES;

export const WINDOW_PITCH = {
  far: { x: 4, y: 5 },
  mid: { x: 6, y: 8 },
  near: { x: 9, y: 12 },
} as const;

export function cityBoxVec(name: CityBoxName): string {
  const box = CITY_BOXES[name];
  return `vec4(${box.x}.0, ${box.y}.0, ${box.width}.0, ${box.height}.0)`;
}

export function pitchVec(name: keyof typeof WINDOW_PITCH): string {
  const pitch = WINDOW_PITCH[name];
  return `vec2(${pitch.x}.0, ${pitch.y}.0)`;
}
