import { CONSTELLATION_DATA, STAR_COUNT, STAR_DATA } from "./catalog-data";

const RAD = Math.PI / 180;

export type Vec3 = readonly [number, number, number];

export function equatorialVector(raDegrees: number, decDegrees: number): Vec3 {
  const ra = raDegrees * RAD, dec = decDegrees * RAD;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

export interface StarCatalog {
  count: number;
  vectors: Float32Array;
  magnitudes: Float32Array;
  colors: Float32Array;
  ra: Float32Array;
  dec: Float32Array;
}

export interface Constellation {
  id: string;
  name: string;
  rank: number;
  label: Vec3;
  lines: readonly (readonly Vec3[])[];
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

let stars: StarCatalog | null = null;
let constellations: Constellation[] | null = null;

export function starCatalog(): StarCatalog {
  if (stars) return stars;
  const bytes = decodeBase64(STAR_DATA);
  const view = new DataView(bytes.buffer);
  const count = Math.floor(bytes.length / 6);
  const made: StarCatalog = { count, vectors: new Float32Array(count * 3), magnitudes: new Float32Array(count), colors: new Float32Array(count), ra: new Float32Array(count), dec: new Float32Array(count) };
  for (let index = 0; index < count; index += 1) {
    const ra = (view.getUint16(index * 6, true) / 65536) * 360;
    const dec = (view.getUint16(index * 6 + 2, true) / 65535) * 180 - 90;
    made.ra[index] = ra;
    made.dec[index] = dec;
    made.vectors.set(equatorialVector(ra, dec), index * 3);
    made.magnitudes[index] = view.getUint8(index * 6 + 4) / 32 - 1.5;
    made.colors[index] = view.getUint8(index * 6 + 5) / 100 - 0.5;
  }
  if (count !== STAR_COUNT) throw new Error("The star catalog is damaged.");
  stars = made;
  return made;
}

export function constellationCatalog(): readonly Constellation[] {
  if (constellations) return constellations;
  constellations = CONSTELLATION_DATA.map(([id, name, rank, ra, dec, lines]) => ({
    id,
    name,
    rank,
    label: equatorialVector(ra / 100, dec / 100),
    lines: lines.map((line) => {
      const points: Vec3[] = [];
      for (let at = 0; at + 1 < line.length; at += 2) points.push(equatorialVector(line[at]! / 100, line[at + 1]! / 100));
      return points;
    }),
  }));
  return constellations;
}
