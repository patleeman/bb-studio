export const REEF_SIZE = 2048;

export interface ReefBox { x: number; y: number; width: number; height: number }

export const REEF_BOXES = {
  near: { x: 0, y: 0, width: 2048, height: 512 },
  kelp: { x: 0, y: 512, width: 2048, height: 704 },
  far: { x: 0, y: 1216, width: 2048, height: 320 },
  whale: { x: 0, y: 1536, width: 768, height: 320 },
  manta: { x: 768, y: 1536, width: 512, height: 320 },
  angler: { x: 1280, y: 1536, width: 448, height: 448 },
  noise: { x: 1728, y: 1536, width: 320, height: 320 },
} as const satisfies Record<string, ReefBox>;

export type ReefBoxName = keyof typeof REEF_BOXES;

export const LURE = { x: 336, y: 92 } as const;

export function boxVec(name: ReefBoxName): string {
  const box = REEF_BOXES[name];
  return `vec4(${box.x}.0, ${box.y}.0, ${box.width}.0, ${box.height}.0)`;
}

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tileNoise(cells: number, seed: number): (x: number, y: number) => number {
  const random = seeded(seed);
  const lattice = Float32Array.from({ length: cells * cells }, () => random());
  const at = (x: number, y: number) => lattice[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)]!;
  return (x, y) => {
    const gx = x * cells, gy = y * cells;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

export function tileFbm(cells: number, octaves: number, seed: number): (x: number, y: number) => number {
  const layers = Array.from({ length: octaves }, (_, octave) => tileNoise(cells * 2 ** octave, seed + octave * 101));
  const total = 2 - 2 ** (1 - octaves);
  return (x, y) => layers.reduce((sum, layer, octave) => sum + layer(x, y) / 2 ** octave, 0) / total;
}
