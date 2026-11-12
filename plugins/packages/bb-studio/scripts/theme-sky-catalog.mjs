import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [starsPath, linesPath, namesPath] = process.argv.slice(2);
if (!starsPath || !linesPath || !namesPath) {
  console.error("usage: node scripts/theme-sky-catalog.mjs <bsc5.dat> <constellations.lines.json> <constellations.json>");
  process.exit(1);
}

const MAG_LIMIT = 5.5;
const number = (text) => (text.trim() === "" ? null : Number(text));

const stars = [];
for (const line of readFileSync(starsPath, "latin1").split("\n")) {
  if (line.length < 107) continue;
  const hours = number(line.slice(75, 77)), minutes = number(line.slice(77, 79)), seconds = number(line.slice(79, 83));
  const sign = line[83] === "-" ? -1 : 1;
  const degrees = number(line.slice(84, 86)), arcminutes = number(line.slice(86, 88)), arcseconds = number(line.slice(88, 90));
  const magnitude = number(line.slice(102, 107));
  if ([hours, minutes, seconds, degrees, arcminutes, arcseconds, magnitude].some((value) => value === null || !Number.isFinite(value))) continue;
  if (magnitude > MAG_LIMIT) continue;
  const color = number(line.slice(109, 114));
  stars.push({
    ra: (hours + minutes / 60 + seconds / 3600) * 15,
    dec: sign * (degrees + arcminutes / 60 + arcseconds / 3600),
    magnitude,
    color: color === null || !Number.isFinite(color) ? 0.6 : color,
  });
}
stars.sort((a, b) => a.magnitude - b.magnitude);

const bytes = Buffer.alloc(stars.length * 6);
stars.forEach((star, index) => {
  bytes.writeUInt16LE(Math.min(65535, Math.round((star.ra / 360) * 65536) % 65536), index * 6);
  bytes.writeUInt16LE(Math.min(65535, Math.round(((star.dec + 90) / 180) * 65535)), index * 6 + 2);
  bytes.writeUInt8(Math.max(0, Math.min(255, Math.round((star.magnitude + 1.5) * 32))), index * 6 + 4);
  bytes.writeUInt8(Math.max(0, Math.min(255, Math.round((star.color + 0.5) * 100))), index * 6 + 5);
});

const centi = (value) => Math.round(value * 100);
const turn = (ra) => ((ra % 360) + 360) % 360;
const named = new Map();
for (const feature of JSON.parse(readFileSync(namesPath, "utf8")).features) named.set(feature.id, [...(named.get(feature.id) ?? []), feature]);
const seen = new Map();
const constellations = [];
for (const feature of JSON.parse(readFileSync(linesPath, "utf8")).features) {
  const parts = named.get(feature.id) ?? [];
  const part = seen.get(feature.id) ?? 0;
  seen.set(feature.id, part + 1);
  const name = parts[part];
  if (!name || feature.geometry.type !== "MultiLineString") continue;
  const [ra, dec] = name.geometry.coordinates;
  constellations.push([
    parts.length > 1 ? `${feature.id}${part + 1}` : feature.id,
    name.properties.name,
    Number(name.properties.rank),
    centi(turn(ra)),
    centi(dec),
    feature.geometry.coordinates.map((line) => line.flatMap(([lineRa, lineDec]) => [centi(turn(lineRa)), centi(lineDec)])),
  ]);
}
constellations.sort((a, b) => a[0].localeCompare(b[0]));

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "theme", "tonight", "catalog-data.ts");
writeFileSync(out, [
  `export const STAR_MAG_LIMIT = ${MAG_LIMIT};`,
  `export const STAR_COUNT = ${stars.length};`,
  `export const STAR_DATA = ${JSON.stringify(bytes.toString("base64"))};`,
  `export const CONSTELLATION_DATA: readonly (readonly [string, string, number, number, number, readonly (readonly number[])[]])[] = ${JSON.stringify(constellations)};`,
  "",
].join("\n"));
console.log(`${stars.length} stars to magnitude ${MAG_LIMIT} and ${constellations.length} constellations written to src/theme/tonight/catalog-data.ts`);
