export interface Shower {
  id: string;
  name: string;
  solarLongitude: number;
  ra: number;
  dec: number;
  zhr: number;
  slope: number;
}

export const SHOWERS: readonly Shower[] = [
  { id: "QUA", name: "Quadrantids", solarLongitude: 283.15, ra: 230, dec: 49, zhr: 110, slope: 1.8 },
  { id: "LYR", name: "Lyrids", solarLongitude: 32.32, ra: 271, dec: 34, zhr: 18, slope: 0.22 },
  { id: "ETA", name: "Eta Aquariids", solarLongitude: 45.5, ra: 338, dec: -1, zhr: 50, slope: 0.08 },
  { id: "SDA", name: "Southern Delta Aquariids", solarLongitude: 127, ra: 340, dec: -16, zhr: 25, slope: 0.09 },
  { id: "PER", name: "Perseids", solarLongitude: 140, ra: 48, dec: 58, zhr: 100, slope: 0.2 },
  { id: "DRA", name: "Draconids", solarLongitude: 195.4, ra: 262, dec: 54, zhr: 10, slope: 1 },
  { id: "ORI", name: "Orionids", solarLongitude: 208, ra: 95, dec: 16, zhr: 20, slope: 0.12 },
  { id: "STA", name: "Southern Taurids", solarLongitude: 223, ra: 52, dec: 15, zhr: 5, slope: 0.03 },
  { id: "NTA", name: "Northern Taurids", solarLongitude: 230, ra: 58, dec: 22, zhr: 5, slope: 0.03 },
  { id: "LEO", name: "Leonids", solarLongitude: 235.27, ra: 152, dec: 22, zhr: 15, slope: 0.4 },
  { id: "GEM", name: "Geminids", solarLongitude: 262.2, ra: 112, dec: 33, zhr: 150, slope: 0.5 },
  { id: "URS", name: "Ursids", solarLongitude: 270.7, ra: 217, dec: 76, zhr: 10, slope: 0.9 },
];

export const ACTIVE_RATE = 1.5;
export const MAX_METEOR_LEVEL = 6;

export function longitudeGap(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

export function showerRate(shower: Shower, solarLongitude: number): number {
  return shower.zhr * 10 ** (-shower.slope * Math.abs(longitudeGap(solarLongitude, shower.solarLongitude)));
}

export function meteorLevel(visiblePerHour: number): number {
  return Math.min(MAX_METEOR_LEVEL, 1 + Math.round(Math.max(0, visiblePerHour) / 3));
}
