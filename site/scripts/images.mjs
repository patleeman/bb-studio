// Turns the raw 2x captures into the site's images: AVIF and WebP at a few
// widths, plus short scene clips as WebM and MP4. Needs sips (macOS),
// avifenc, cwebp and ffmpeg on PATH.
//
//   node images.mjs <raw-dir> [presence-sheet.png]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../assets");
const [raw] = process.argv.slice(2);
if (!raw) throw new Error("usage: images.mjs <raw-dir>");
mkdirSync(join(out, "img"), { recursive: true });
mkdirSync(join(out, "video"), { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "bbsite-img-"));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });

// name -> { crop?: [x, y, w, h] in 2x pixels, widths }
const SHOTS = {
  "theme-miami-1985": { widths: [800, 1600, 2400] },
  "theme-event-horizon": { widths: [800, 1600] },
  "theme-grid": { widths: [800, 1600] },
  "theme-kyoto-garden": { widths: [800, 1600] },
  "theme-forest": { widths: [800, 1600] },
  "theme-aurora-fjord": { widths: [800, 1600] },
  "theme-tonights-sky": { widths: [800, 1600] },
  "theme-data-city": { widths: [800, 1600] },
  "theme-deep-sea": { widths: [800, 1600] },
  "theme-bb-default": { widths: [800, 1600] },
  "theme-one-dark": { widths: [800, 1600] },
  "theme-dracula": { widths: [800, 1600] },
  "theme-solarized-light": { widths: [800, 1600] },
  "theme-github-light": { widths: [800, 1600] },
  "theme-github-dark": { widths: [800, 1600] },
  "theme-nord": { widths: [800, 1600] },
  "theme-catppuccin-mocha": { widths: [800, 1600] },
  approval: { widths: [820, 1640] },
  sidebar: { widths: [290, 580] },
  "page-memory": { widths: [800, 1600] },
  "page-todos": { widths: [800, 1600] },
  "page-automations": { widths: [800, 1600] },
  "page-skills": { widths: [800, 1600] },
  accounts: { crop: [0, 1860, 580, 1440], widths: [290, 580] },
  workbench: { widths: [800, 1600, 2400] },
  cmdk: { crop: [700, 40, 2300, 1200], widths: [800, 1600] },
  "edit-space": { widths: [800, 1600] },
  "replies-open": { widths: [800, 1600, 2400] },
  "presence-sheet": { widths: [600, 1200] },
  "item-page": { widths: [800, 1600, 2400] },
  "item-page-embeds": { widths: [800, 1600] },
  "item-design": { crop: [1500, 720, 1700, 820], widths: [850, 1700] },
  "item-whiteboard": { widths: [800, 1600] },
  "item-dashboard": { widths: [800, 1600, 2400] },
  "item-mini": { crop: [0, 0, 3200, 1200], widths: [800, 1600] },
  "item-artifact": { crop: [0, 0, 3200, 1200], widths: [800, 1600] },
  "item-recording": { widths: [800, 1600, 2400] },
  "item-notes": { crop: [0, 0, 3200, 1400], widths: [800, 1600] },
  "item-dictation": { crop: [0, 0, 3200, 1400], widths: [800, 1600] },
  "item-collection": { crop: [0, 0, 3200, 1200], widths: [800, 1600] },
  "item-code": { widths: [800, 1600, 2400] },
  composer: { crop: [1180, 1520, 1500, 420], widths: [750, 1500] },
  "ios-bot-chat": { widths: [400, 800] },
  "ios-bot-approval": { widths: [400, 800] },
  "ios-widgets": { widths: [400, 800] },
};

for (const [name, spec] of Object.entries(SHOTS)) {
  const src = join(raw, `${name}.png`);
  if (!existsSync(src)) { console.warn("missing", name); continue; }
  let input = src;
  if (spec.crop) {
    const [x, y, w, h] = spec.crop;
    input = join(tmp, `${name}-crop.png`);
    run("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-vf", `crop=${w}:${h}:${x}:${y}`, input]);
  }
  for (const width of spec.widths) {
    const png = join(tmp, `${name}-${width}.png`);
    run("sips", ["-s", "format", "png", "--resampleWidth", String(width), input, "--out", png]);
    const alpha = false;
    run("avifenc", ["-q", "60", "-s", "6", ...(alpha ? [] : []), png, join(out, "img", `${name}-${width}.avif`)]);
    run("cwebp", ["-quiet", "-q", "78", ...(alpha ? ["-exact", "-alpha_q", "90"] : []), png, "-o", join(out, "img", `${name}-${width}.webp`)]);
  }
  console.log("image", name);
}

// Clips: 6 seconds from the middle of each recording, 960 wide, no audio.
for (const file of readdirSync(raw).filter((f) => f.startsWith("clip-") && f.endsWith(".webm"))) {
  const name = basename(file, ".webm");
  const src = join(raw, file);
  const common = ["-loglevel", "error", "-y", "-ss", "8", "-t", "6", "-i", src, "-an", "-vf", "scale=960:-2,fps=24"];
  run("ffmpeg", [...common, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "42", "-row-mt", "1", join(out, "video", `${name}.webm`)]);
  run("ffmpeg", [...common, "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, "video", `${name}.mp4`)]);
  run("ffmpeg", ["-loglevel", "error", "-y", "-ss", "8", "-i", src, "-frames:v", "1", "-vf", "scale=960:-2", join(tmp, `${name}.png`)]);
  run("cwebp", ["-quiet", "-q", "70", join(tmp, `${name}.png`), "-o", join(out, "video", `${name}-poster.webp`)]);
  console.log("clip", name);
}

rmSync(tmp, { recursive: true, force: true });
writeFileSync(join(out, ".generated"), "Made by scripts/images.mjs from fresh captures. Do not edit by hand.\n");
