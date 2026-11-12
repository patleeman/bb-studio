// Builds the static site into dist/: expands the {{pic}}, {{theme}}, {{clip}}
// and {{srcset}} tags in src/index.html from the images in assets/, and copies
// the rest. Every URL is relative, so the site works under any base path
// (for example https://patleeman.github.io/bb-studio-site/).
//
//   node scripts/build.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(site, "..");
const dist = join(site, "dist");
const imgDir = join(site, "assets/img");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const files = readdirSync(imgDir);
const widthsOf = (name) => files
  .map((f) => new RegExp(`^${name}-(\\d+)\\.webp$`).exec(f)?.[1])
  .filter(Boolean).map(Number).sort((a, b) => a - b);
const esc = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function srcset(name, format) {
  return widthsOf(name).map((w) => `img/${name}-${w}.${format} ${w}w`).join(", ");
}
function pic(name, alt, sizes, eager = false) {
  const widths = widthsOf(name);
  if (!widths.length) throw new Error(`no images for ${name}`);
  const largest = widths.at(-1);
  // The 2x captures keep the window's 16:10 shape unless cropped; read the size from the WebP header.
  const { width, height } = webpSize(join(imgDir, `${name}-${largest}.webp`));
  const fallback = widths.find((w) => w >= 1200) ?? largest;
  return `<picture>
      <source type="image/avif" srcset="${srcset(name, "avif")}" sizes="${sizes}">
      <img src="img/${name}-${fallback}.webp" srcset="${srcset(name, "webp")}" sizes="${sizes}" width="${width}" height="${height}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
    </picture>`;
}
function webpSize(path) {
  const b = readFileSync(path);
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8L") { const bits = b.readUInt32LE(21); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }; }
  return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
}
function theme(name, title, text) {
  const alt = `BB Studio with the ${title} theme on the Main conversation of the Bot Atlas.`;
  return `<figure class="shot theme">
      ${pic(name, alt, "(min-width: 1100px) 350px, (min-width: 900px) 45vw, 94vw")}
      <figcaption><strong>${esc(title)}</strong>${text ? esc(text) : ""}</figcaption>
    </figure>`;
}
function clip(name, label) {
  const poster = `video/${name}-poster.webp`;
  if (!existsSync(join(site, "assets", poster))) return "";
  return `<figure class="shot clip">
      <video data-clip muted loop playsinline controls preload="none" poster="${poster}" width="960" height="600" aria-label="${esc(label)}">
        <source src="video/${name}.webm" type="video/webm">
        <source src="video/${name}.mp4" type="video/mp4">
      </video>
    </figure>`;
}

// {{name arg "quoted arg" ...}}
const html = readFileSync(join(site, "src/index.html"), "utf8").replace(/\{\{(\w+)\s+([^}]*)\}\}/g, (_, fn, rest) => {
  const args = [...rest.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  if (fn === "pic") return pic(args[0], args[1], args[2], args[3] === "eager");
  if (fn === "theme") return theme(args[0], args[1], args[2]);
  if (fn === "clip") return clip(args[0], args[1]);
  if (fn === "srcset") return srcset(args[0], args[1]);
  throw new Error(`unknown tag ${fn}`);
});
if (/\s(src|href)="\//.test(html)) throw new Error("absolute URL in index.html; keep every URL relative");
writeFileSync(join(dist, "index.html"), html);

for (const entry of ["styles.css", "site.js", "icon.png", "fonts"]) cpSync(join(site, "src", entry), join(dist, entry), { recursive: true });
cpSync(imgDir, join(dist, "img"), { recursive: true });
if (existsSync(join(site, "assets/video"))) cpSync(join(site, "assets/video"), join(dist, "video"), { recursive: true });
cpSync(join(repo, "NOTICE"), join(dist, "NOTICE.txt"));
cpSync(join(repo, "LICENSE"), join(dist, "LICENSE.txt"));
writeFileSync(join(dist, ".nojekyll"), "");

const size = (dir) => readdirSync(dir).reduce((sum, f) => { const p = join(dir, f); return sum + (statSync(p).isDirectory() ? size(p) : statSync(p).size); }, 0);
console.log(`dist: ${(size(dist) / 1e6).toFixed(2)} MB`);
