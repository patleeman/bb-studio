import { describe, expect, it } from "vitest";
import { checkTheme, shaderShapeChecks, STATIC_BUDGET, staticCost } from "../checks";
import { forestUniforms } from "../forest/sky";
import { TILES, tileVec, type TileName } from "../kyoto/atlas";
import { readGarden } from "../kyoto/scene";
import { resolveLook } from "../look";
import { PRELUDE } from "../scene/contract";
import { createThemeRegistry, SCENE_THEMES } from "../registry";
import { SURFACES, themeModes } from "../schema";
import { THEME_FORMAT_GUIDE, THEME_TEMPLATE } from "../template";
import { lookTokens } from "../tokens";
import { composeSky, tonightUniforms } from "../tonight/compose";
import { nightSky } from "../tonight/ephemeris";
import { frameSky } from "../tonight/projection";
import { AURORA_FJORD } from "./aurora-fjord";
import { DATA_CITY } from "./data-city";
import { DEEP_SEA } from "./deep-sea";
import { EVENT_HORIZON } from "./event-horizon";
import { FOREST } from "./forest";
import { GRID } from "./grid";
import { KYOTO_GARDEN } from "./kyoto-garden";
import { MIAMI } from "./miami";
import { TONIGHTS_SKY } from "./tonights-sky";

const NEW_SCENES = [MIAMI, EVENT_HORIZON, GRID, KYOTO_GARDEN, FOREST, AURORA_FJORD, TONIGHTS_SKY, DATA_CITY, DEEP_SEA];

const AMBIENT: Record<string, Record<string, RegExp>> = {
  "miami-1985": {
    "the grid scrolling toward the viewer": /zc = z \+ u_time \* u_gridSpeed/,
    "a glow row riding the grid": /row = smoothstep\([^;]*fract\(zc \* 0\.25\)/,
    "the sun's stripes drifting": /stripe = fract\(band \* 8\.5 \+ u_time \* 0\.06\)/,
    "palms swaying": /float palm\([^)]*float phase\) \{\s*float sway = sin\(u_time \* 0\.26 \+ phase\)/,
    "a far glider pass": /pass = u_time \/ 64\.0/,
    "worker gliders sweeping a figure-eight": /turn = w\.y \* 0\.21 \+ w\.x \* 6\.2832;[\s\S]*sin\(turn\)[\s\S]*sin\(2\.0 \* turn\)/,
  },
  "event-horizon": {
    "the disk orbiting": /ang = atan\(P\.z, P\.x\) - u_time \* u_spin \* omega/,
    "the sky turning": /a = u_time \* 0\.004/,
  },
  grid: {
    "the floor scrolling": /z \+ u_time \* u_scroll/,
    "light trails along the floor lines": /slot = u_time \* 0\.04 \+ hash11\(id/,
    "the ring's sweep": /cos\(ang - u_time \* 0\.2\)/,
    "the ring's dashes turning": /dash = smoothstep\([^;]*ang \+ u_time \* 0\.105/,
    "particles rising": /float motes\([^{]*\{\s*vec2 q = [^;]*- u_time \* 0\.06/,
    "the skyline layers passing at their own rates": /city\(x \+ u_time \* 0\.0015,[\s\S]*city\(x \+ u_time \* 0\.004,[\s\S]*city\(x \+ u_time \* 0\.009,/,
    "the ring turning": /float spin = u_time \* 0\.02;/,
    "windows going on and off": /floor\(u_time \* 0\.025 \+ h \* 8\.0\)/,
    "searchlights sweeping": /float a = 0\.42 \* sin\(u_time \* \(0\.05/,
    "distant traffic": /u_time \* \(0\.25 \+ 0\.1 \* fi\)/,
    "a scan pulse crossing the floor": /fract\(u_time \* 0\.045\) \* 24\.0/,
    "clouds drifting": /cloud = noise\(vec2\(x \* 1\.3 \+ u_time \* 0\.008/,
    "glints on the floor's nodes": /glint = lx \* lz [^;]*sin\(u_time \* 1\.1 \+ node \* 60\.0\)/,
  },
  "kyoto-garden": {
    "bamboo swaying": /bx = q\.x \+ sway \* 0\.006 - rise \* rise \* \(0\.03 \+ 0\.035 \* sin\(u_time \* 0\.31 \+ 3\.0 \* q\.x\)\)/,
    "petals, leaves or snow drifting down at three depths": /vec4 drift\([^{]*\{\s*vec2 q = p \* scale \+ fall \* u_time;[\s\S]*drift\(wind, 10\.0,[\s\S]*drift\(wind \+ 0\.37, 6\.0,[\s\S]*drift\(wind \+ 0\.71, 3\.5,/,
    "the layers swaying against each other": /sway = sin\(u_time \* 0\.11\)[\s\S]*x0 = q\.x \+ sway \* 0\.0015[\s\S]*x2 = q\.x \+ sway \* 0\.004[\s\S]*sx = p\.x \+ sway \* 0\.02/,
    "the maple's leaves stirring": /mu \+= 0\.0009 \* rise \* vec2\(sin\(u_time \* 0\.9/,
    "dappled shade shifting on the moss": /dapple = tile\([^;]*sin\(u_time \* 0\.5 /,
    "slow rings on the pond": /tt = u_time \* 0\.07 \+ float\(i\) \* 0\.37/,
    "the pond's surface wavering": /wv = noise\(vec2\(gp\.x \* 3\.0 \+ u_time \* 0\.05, gp\.y \* 8\.0 - u_time \* 0\.07\)\)/,
    "mist drifting": /mist = noise\(vec2\(q\.x \* 1\.6 - u_time \* 0\.02/,
    "clouds drifting": /cq = vec2\(q\.x \* 0\.5 \+ u_time \* 0\.006/,
    "leaves floating across the pond": /lc = vec2\(gp\.x \* 8\.0 \+ pond \* u_time \* 0\.02/,
    "fireflies on summer nights": /blink = max\(0\.0, sin\(u_time \* rate[\s\S]*blink \* blink [^;]*night \* summer;/,
  },
  forest: {
    "trees swaying": /float pineLayer\([^{]*\{[^}]*sway = sin\(u_time \* 0\.3/,
    "clouds moving": /cp = vec2\(p\.x \* 2\.2 \+ u_time \* 0\.03/,
    "mist drifting": /mp = vec2\(p\.x \* 1\.4 - u_time \* 0\.035/,
    "fireflies at dusk and night": /bugs \* max\(dark, u_twilight\)/,
    "fireflies wandering": /float fireflies\([\s\S]*?sin\(u_time \* 0\.4 \* rate/,
    "rain with the weather": /float rainLayer\([^{]*\{[^}]*u_time \* speed[\s\S]*rain \* u_rain/,
  },
  "aurora-fjord": {
    "the curtains folding": /float fold\([^{]*\{\s*float bend = noise\([^;]*u_time \* 0\.016[\s\S]*?sin\(g\.x \* 2\.1 \+ u_time \* 0\.07/,
    "the rays shimmering": /rays = noise1\(along \+ u_time \* 0\.09\)[^;]*noise1\(along \* 3\.3 - u_time \* 0\.13\)/,
    "the aurora's activity wandering": /active = [^;]*q\.x \* 0\.8 - u_time \* 0\.012/,
    "the water's reflection wavering": /swell = noise\([^;]*u_time \* 0\.03, u_time \* 0\.09\)/,
    "the layers swaying against each other": /sway = sin\(u_time \* 0\.11\)[\s\S]*x0 = q\.x \+ sway \* 0\.0015[\s\S]*x1 = q\.x \+ sway \* 0\.004[\s\S]*x2 = q\.x \+ sway \* 0\.009[\s\S]*sx = p\.x \+ sway \* 0\.016/,
    "mist drifting over the water": /mist = noise\(vec2\(q\.x \* 3\.0 \+ u_time \* 0\.02/,
    "stars twinkling": /twinkle = 0\.75 \+ 0\.25 \* sin\(u_time \* 1\.3/,
    "a shooting star": /turn = u_time \/ 43\.0/,
  },
  "tonights-sky": {
    "stars twinkling": /twinkle = [^;]*sin\(u_time \* \(1\.3 \+ 2\.2 \* ci\)/,
    "the Milky Way's faint stars shimmering": /dust \* 0\.7 \* clearAir \* \(0\.75 \+ 0\.25 \* sin\(u_time/,
    "shooting stars, more of them at a shower's peak": /turn = u_time \/ period[\s\S]*if \(fi >= u_meteors \|\| fall >= 1\.0\) continue;/,
    "satellites crossing": /t = fract\(w\.x \* 3\.7 \+ w\.y \* 0\.0075\)/,
  },
  "data-city": {
    "the glide down the avenue, one loop a period": /turn = fract\(u_time \/ u_period\)[\s\S]*ro = vec3\([^;]*turn \* u_blocks\)/,
    "the camera banking": /bank = 0\.035 \* sin\(ang \+ 0\.6\)/,
    "glyph columns scrolling at their own rates": /gy = v \* rows \+ rate \* 32\.0 \* turn/,
    "glyphs changing": /tick = floor\(turn \* 96\.0\)/,
    "distant towers flickering": /flicker = 1\.0 - 0\.5 \* far \* [^;]*floor\(turn \* 144\.0\)/,
    "panels drifting": /at = vec2\([^;]*sin\(ang \* \(1\.0 \+ fi\)/,
  },
  "deep-sea": {
    "the god rays wandering": /g1 = grain\(vec2\(fall \* 0\.55 \+ u_time \* 0\.004/,
    "the surface rippling": /r1 = grain\(sp \* vec2\(0\.55, 1\.4\) \+ vec2\(u_time \* 0\.011, u_time \* 0\.02\)\)/,
  },
};

describe("the built-in scene themes", () => {
  it("are listed in the picker's scene row as Miami 1985, Event Horizon, Grid, Kyoto Garden, Forest, Aurora Fjord, Tonight's Sky, Data City, Deep Sea", () => {
    expect(SCENE_THEMES.map((theme) => theme.name)).toEqual(["Miami 1985", "Event Horizon", "Grid", "Kyoto Garden", "Forest", "Aurora Fjord", "Tonight's Sky", "Data City", "Deep Sea"]);
    expect(createThemeRegistry().scenes().map((entry) => entry.theme.id)).toEqual(["miami-1985", "event-horizon", "grid", "kyoto-garden", "forest", "aurora-fjord", "tonights-sky", "data-city", "deep-sea"]);
  });

  for (const theme of NEW_SCENES) {
    it(`${theme.name} passes every check: schema, contrast on each surface in each mode, shader shape, cost, reduced motion`, () => {
      const report = checkTheme(theme);
      expect(report.pass, report.results.filter((line) => !line.pass).map((line) => line.reason).join("; ")).toBe(true);
      const ids = report.results.map((line) => line.id);
      for (const mode of themeModes(theme)) for (const surface of SURFACES) expect(ids).toContain(`contrast:${mode}:${surface}`);
      expect(ids).not.toContain("shader");
      expect(ids).toEqual(expect.arrayContaining(["schema", "frame-time", "backdrop", "reduced-motion"]));
      if (theme.scene.kind !== "shader") throw new Error("A scene theme has a shader");
      expect(staticCost(theme.scene.source)).toBeLessThanOrEqual(STATIC_BUDGET);
    });

    it(`${theme.name} starts below full intensity to keep its mood, and places its focal element beside the transcript card (u_clear)`, () => {
      if (theme.scene.kind !== "shader") throw new Error("A scene theme has a shader");
      expect(theme.defaults.intensity).toBeGreaterThanOrEqual(0.7);
      expect(theme.defaults.intensity).toBeLessThanOrEqual(0.85);
      expect(theme.scene.source).toMatch(/\bu_clear\.z\b/);
      expect(shaderShapeChecks({ ...theme.scene, source: `uniform vec4 u_clear;\n${theme.scene.source}` })).toContain("It declares u_clear, which the engine declares.");
    });

    it(`${theme.name} draws its workers, the needs-you glow and the finished and error ripples`, () => {
      if (theme.scene.kind !== "shader") throw new Error("A scene theme has a shader");
      for (const uniform of ["u_workers", "u_workerColor", "u_needsYou", "u_needsYouColor", "u_ripples", "u_finishedColor", "u_errorColor"]) {
        expect(theme.scene.source, uniform).toMatch(new RegExp(`\\b${uniform}\\b`));
      }
    });
  }

  for (const theme of NEW_SCENES) {
    it(`${theme.name} keeps slow ambient motion on u_time and a still frame for reduced motion`, () => {
      if (theme.scene.kind !== "shader") throw new Error("A scene theme has a shader");
      const source = theme.scene.source;
      const layers = AMBIENT[theme.id]!;
      expect(Object.keys(layers).length).toBeGreaterThanOrEqual(2);
      for (const [layer, pattern] of Object.entries(layers)) expect(source, layer).toMatch(pattern);
      expect(theme.scene.still).toBeGreaterThan(0);
      expect(theme.motion.speed).toBe(1);
      const rates = [...source.matchAll(/u_time \* (\d+(?:\.\d+)?)/g)].map((found) => Number(found[1]));
      expect(Math.max(...rates), "the fastest u_time factor").toBeLessThanOrEqual(10);
    });
  }

  it("keeps every scene's workers in the open area and fades them before a card's edge (u_open, openFade)", () => {
    for (const theme of [MIAMI, EVENT_HORIZON, GRID, KYOTO_GARDEN, FOREST, AURORA_FJORD, DATA_CITY, DEEP_SEA]) {
      if (theme.scene.kind !== "shader") throw new Error("A scene theme has a shader");
      const source = theme.scene.source;
      const workers = source.slice(source.indexOf("u_workers[i]"));
      const loop = workers.slice(0, workers.indexOf("\n  }\n") > 0 ? workers.indexOf("\n  }\n") : workers.length);
      expect(source, theme.id).toMatch(/openFade\(gl_FragCoord\.xy(, [^;)]*)?\)/);
      expect(loop, theme.id).toMatch(/u_workerColor \* [^;]*(clearing|openFade\(gl_FragCoord\.xy\))|mix\(col, glider\([^;]*clearing\)/);
      expect(loop, theme.id).not.toMatch(/fract\([^;]*\) \* aspect|head = fract\(/);
      expect(shaderShapeChecks({ ...theme.scene, source: `uniform vec4 u_open;\n${source}` })).toContain("It declares u_open, which the engine declares.");
    }
    if (MIAMI.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    const miami = MIAMI.scene.source;
    expect(miami).toMatch(/float lo = o0 \+ 0\.1 \+ 0\.02 \* fit;\s*float reach = max\(0\.5 \* \(o0 \+ ow - 0\.045 \* fit - lo\), 0\.0\);/);
    expect(miami).toMatch(/vec2 far = vec2\(o0 \+ mix\(-0\.05, ow \+ 0\.15, along\),/);
    expect(miami).toMatch(/if \(clearing \* ow > 0\.0\) \{/);
    expect(miami).not.toMatch(/mix\(-0\.2, aspect \+ 0\.2, along\)/);
    expect(PRELUDE).toMatch(/float openFade\(vec2 at, float inset\) \{[\s\S]*smoothstep\(inset, 2\.2 \* inset, away\)[\s\S]*float openFade\(vec2 at\) \{\s*return openFade\(at, 0\.045 \* u_resolution\.y\);/);
    expect(THEME_FORMAT_GUIDE).toContain("multiply all it draws by openFade(gl_FragCoord.xy)");
    if (THEME_TEMPLATE.scene.kind !== "shader") throw new Error("The template has a shader");
    expect(THEME_TEMPLATE.scene.source).toMatch(/u_workerColor \* openFade\(gl_FragCoord\.xy\)/);
  });

  it("gives the template moving rays and tells theme authors to add slow ambient motion", () => {
    if (THEME_TEMPLATE.scene.kind !== "shader") throw new Error("The template has a shader");
    expect(THEME_TEMPLATE.scene.source).toMatch(/float t = u_time \* 0\.25;[\s\S]*rays = [^;]*\+ t \* 0\.7\)/);
    expect(THEME_TEMPLATE.scene.still).toBeGreaterThan(0);
    expect(THEME_FORMAT_GUIDE).toContain("slow ambient motion from u_time");
  });

  it("draws Aurora Fjord as curtains over a mirrored fjord: sheets crossed along the sight line, three ranges of peaks, a reflection, a natural shore with no hut", () => {
    if (AURORA_FJORD.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    const source = AURORA_FJORD.scene.source;
    expect(source).toMatch(/for \(int i = 1; i <= 13; i\+\+\) \{[\s\S]*abs\(fb - fa\) \/ max\(abs\(span\), 0\.1\)/);
    expect(source).toMatch(/tint = mix\(mix\(u_palette\[1\],[^;]*u_palette\[2\]/);
    expect(source).toMatch(/vec2 q = vec2\([^;]*mix\(uv\.y, hz \+ dw \* 1\.04 \+ wave, below\)\)/);
    expect(source.match(/\bridge\(x/g)!.length + source.match(/= peak\(q,/g)!.length).toBeGreaterThanOrEqual(4);
    expect(source).toMatch(/col = mix\(col, mix\(mid\.rgb, haze \* 1\.2, 0\.5\), mid\.a\);[\s\S]*col = mix\(col, mix\(near\.rgb, haze, 0\.06\), near\.a\);/);
    expect(source).toMatch(/focus = \(wide \? \(u_clear\.z \+ 0\.5 \* strip\) \/ u_resolution\.x : 0\.86\) \* aspect/);
    expect(source).toMatch(/hq = \(p - vec2\(focus \+ sway \* 0\.016, hz - 0\.016\)\) \/ 0\.03/);
    expect(source).not.toMatch(/bar1|sill|jamb|\bhut\b|\broof\b|\bpane\b/);
    expect(source).toMatch(/if \(r\.w > 0\.5 && r\.w < 1\.5\) boost \+=/);
    expect(source).toMatch(/float cover = max\(smoothstep\(0\.2 \* u_resolution\.x \+ edge, 0\.2 \* u_resolution\.x, gl_FragCoord\.x\), smoothstep\(u_clear\.x - edge, u_clear\.x, gl_FragCoord\.x\) \* smoothstep\(u_clear\.z \+ edge, u_clear\.z, gl_FragCoord\.x\)\);/);
    expect(source).toMatch(/au \*= mix\(0\.9, 0\.7, cover\) \* /);
    expect(source).toMatch(/vec3 water = [^;]*\+ au \* 0\.14/);
    expect(source).toMatch(/lamp = u_needsYou \* \(0\.7 \+ 0\.8 \* pulse\)/);
    expect(source).toMatch(/if \(r\.w < 1\.5\) continue;[\s\S]*col \+= u_errorColor \*/);
    expect(source).toMatch(/col \+= u_workerColor \* clearing \* \([^;]*step\(0\.006, -d\.y\) \* exp\(/);
    expect(AURORA_FJORD.glass).toMatchObject({ sidebar: { opacity: 0.14, blur: 6 }, main: { opacity: 0.03, blur: 0 }, transcript: { opacity: 0.16, blur: 6 }, composer: { opacity: 0.42, blur: 10 } });
    expect(AURORA_FJORD.variants.dark!.accent).toBe("#5fe8a5");
    expect(AURORA_FJORD.type.heading).toMatch(/^Optima,/);
    expect(AURORA_FJORD.radius).toBe(6);
    expect(AURORA_FJORD.effects.worker.character).toBe("fishing boat with a lantern");
  });

  it("draws Grid in depth: three painted skylines with haze between them, a segmented ring that turns, light cycles whose walls are neon ribbons (a bright top line over a soft glow, no bands) joined at a turn by one line from top to top, with reflections, a flat-sunk near skyline and one plain tower at the open strip's left edge, and a floor that mirrors them", () => {
    if (GRID.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    const source = GRID.scene.source;
    expect(source.match(/= city\(x \+ u_time/g)).toHaveLength(3);
    expect(source).toMatch(/if \(u_city < 0\.5\) return towers\(/);
    expect(source.match(/col = mix\(col, fog \+ line \* /g)).toHaveLength(2);
    expect(source).toMatch(/float sy = mix\(max\(uv\.y - hz, 0\.0\), d \* 0\.8, below\);/);
    expect(source).toMatch(/vec3 ground = [^;]*col \* \(0\.3 \+ 0\.5 \* tile\)/);
    expect(source).toMatch(/vec2 rq = vec2\(rc\.x \* cos\(spin\)[^;]*;\s*vec4 ring = atlas\(rq \* 0\.5 \+ 0\.5, vec4\(/);
    expect(source).toMatch(/float rx = wide \? 0\.5 \* \(rlo \+ rhi\) \/ res : 0\.5 \* aspect;/);
    expect(source).toMatch(/city\(x \+ u_time \* 0\.009, sy \+ sink \* 0\.48, 0\.48,/);
    expect(source).toMatch(/vec4 bike = atlas\(vec2\(1\.0 \+ \(uv\.x - head\) \* dir \/ bl, \(uv\.y - rowY\) \/ bh\)/);
    expect(source).toMatch(/float wall\([^{]*\{[\s\S]*step\(above, 0\.0\) \* exp\(above \* 90\.0\)/);
    const wall = source.slice(source.indexOf("float wall("), source.indexOf("vec3 face("));
    expect(wall).toMatch(/exp\(-top \* res \* 1\.2\) \* 3\.0 \+ exp\(-top \* res \* 0\.12\) \* 0\.7/);
    expect(wall).not.toMatch(/fract\(/);
    expect(source).toMatch(/float sink = wide \? 0\.35 \* smoothstep\(edgeX - 0\.08, edgeX - 0\.01, x\)/);
    expect(source).toMatch(/float tower = wide \? step\(0\.0, tx\) \* step\(tx, 1\.0\) \* step\(sy, 0\.17\)/);
    expect(source).toMatch(/float wallA = wall\(uv, row, from, tail,[\s\S]*float wallB = wall\(uv, other, from, to,/);
    expect(source).toMatch(/uv\.y - clamp\(uv\.y, min\(topA, topB\), max\(topA, topB\)\)/);
    expect(source).toMatch(/float walls = max\(max\(wallA, wallB\), joint\);/);
    expect(source).not.toMatch(/float post = /);
    expect(GRID.radius).toBe(2);
    expect(GRID.palette).toEqual(["#010305", "#5ff6ff", "#e9feff", "#ff9a2e"]);
    expect(GRID.effects.worker.character).toBe("light cycle");
  });

  it("draws Tonight's Sky from the driver's picture (u_layer) and view, with a horizon, a light-pollution glow, the Moon's phase and an eclipse's red", () => {
    if (TONIGHTS_SKY.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    const source = TONIGHTS_SKY.scene.source;
    expect(source).toMatch(/vec4 layer = texture2D\(u_layer, uv\);/);
    expect(source).not.toMatch(/uniform sampler2D u_layer/);
    expect(source).toMatch(/pl = \(p - vec2\(u_center, u_view\.y\)\) \/ u_view\.x/);
    expect(source).toMatch(/col \+= u_palette\[3\] \* haze \* \(0\.05 \+ 0\.34 \* side\)/);
    expect(source).toMatch(/shade = smoothstep\(-0\.06, 0\.1, dot\(vec3\(mq, mz\), u_moonLit\.xyz\)\)/);
    expect(source).toMatch(/face = mix\(face, vec3\(0\.6, 0\.17, 0\.08\), u_moonLit\.w\)/);
    expect(source).toMatch(/if \(u_radiant\.z > 0\.5 && i > 0\) dir = normalize\(start - u_radiant\.xy/);
    expect(source).toMatch(/nearRidge = [^;]*\+ tree;/);
    expect(source.match(/faint\(gl, lat, /g)).toHaveLength(2);
    expect(source).toMatch(/float rift = 1\.0 - [^;]*smoothstep\([^;]*lane/);
    expect(source).toMatch(/float milky = \(band \* [^;]*\* rift;/);
    expect(source).toMatch(/vec3 tint = r\.w > 1\.5 \? u_errorColor : u_finishedColor;/);
    expect(source).toMatch(/focus = \(wide \? \(u_clear\.z \+ 0\.5 \* strip\) \/ u_resolution\.x : 0\.8\) \* aspect/);
    const sky = nightSky(new Date("2026-11-12T02:00:00Z"), { latitude: 41.03, longitude: -73.76 });
    const camera = frameSky(null, 41.03, { width: 1600, height: 1000 });
    expect(Object.keys(TONIGHTS_SKY.scene.uniforms).sort()).toEqual(Object.keys(tonightUniforms(sky, camera)).sort());
    expect(TONIGHTS_SKY.scene.uniforms.u_view).toEqual(tonightUniforms(sky, camera).u_view);
    expect(TONIGHTS_SKY.scene.uniforms.u_center).toBe(camera.anchorX);
    expect(composeSky(sky, camera).segments.length).toBeGreaterThan(60);
    expect(TONIGHTS_SKY.glass).toMatchObject({ sidebar: { opacity: 0.14, blur: 6 }, main: { opacity: 0.03, blur: 0 }, transcript: { opacity: 0.16, blur: 6 }, composer: { opacity: 0.42, blur: 10 } });
    expect(TONIGHTS_SKY.radius).toBe(6);
    expect(TONIGHTS_SKY.defaults.intensity).toBe(0.8);
    expect(themeModes(TONIGHTS_SKY)).toEqual(["light", "dark"]);
    expect(source).toMatch(/vec3 air = mix\(low, zenith, pow\(h, 0\.42\)\);/);
    expect(source).toMatch(/col = mix\(col, air, lit\);/);
    expect(source).toMatch(/face = mix\(face, col \+ vec3\(0\.6, 0\.62, 0\.66\) \* shade \* maria, lit\);/);
    expect(TONIGHTS_SKY.effects.worker.character).toBe("satellite crossing the sky");
    expect(TONIGHTS_SKY.credit?.license).toBe("MIT");
    expect(staticCost(source)).toBeLessThan(1100);
  });

  it("sets Kyoto Garden's transcript in a serif in its light and its dark variant, and leaves other transcripts in the body font", () => {
    expect(themeModes(KYOTO_GARDEN)).toEqual(["light", "dark"]);
    for (const mode of themeModes(KYOTO_GARDEN)) expect(lookTokens(resolveLook(KYOTO_GARDEN, KYOTO_GARDEN.defaults, mode))["--studio-font-transcript"]).toMatch(/^"Iowan Old Style",.*serif$/);
    const miami = lookTokens(resolveLook(MIAMI, MIAMI.defaults, "dark"));
    expect(miami["--studio-font-transcript"]).toBe(miami["--font-sans"]);
  });

  it("draws Kyoto Garden from its driver's season, light and weather: a mirrored pond, a maple, a lantern and a moon in the open strip, lanterns for workers", () => {
    if (KYOTO_GARDEN.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    const source = KYOTO_GARDEN.scene.source;
    const reading = readGarden(new Date("2026-11-11T03:00:00Z"), { place: { name: "Kyoto, Japan", latitude: 35, longitude: 135.8, source: "city" }, weather: null });
    expect(Object.keys(KYOTO_GARDEN.scene.uniforms).sort()).toEqual(Object.keys(reading.uniforms).sort());
    expect(KYOTO_GARDEN.scene.uniforms).toMatchObject({ u_season: reading.uniforms.u_season, u_weather: reading.uniforms.u_weather });
    expect(source).toMatch(/uniform vec4 u_season;\s*uniform vec4 u_sky;\s*uniform vec3 u_weather;/);
    expect(source).toMatch(/float spring = u_season\.x;\s*float summer = u_season\.y;\s*float autumn = u_season\.z;\s*float winter = u_season\.w;/);
    expect(source).toMatch(/vec2 q = mix\(vec2\(p\.x \+ haze, p\.y\), vec2\(g\.x \+ wv \* 0\.008, 0\.42 \+ \(0\.42 - g\.y\) \* 1\.1 \+ wv \* 0\.016\), pond\);/);
    expect(source).toMatch(/focus = \(strip > 0\.09 \* u_resolution\.x \? \(u_clear\.z \+ 0\.5 \* strip\) \/ u_resolution\.x : 0\.86\) \* aspect/);
    expect(source).toMatch(/mq = \(q - vec2\(focus - 0\.08, 0\.684\)\) \/ 0\.027/);
    expect(source).toMatch(/mu = vec2\(\(q\.x \+ sway \* \(0\.004 \+ 0\.02 \* rise\) - focus \+ 1\.0\) \/ 1\.44, \(q\.y - 0\.38\) \/ 0\.64\)/);
    expect(source).toMatch(/lq = \(vec2\(q\.x \+ sway \* 0\.004, q\.y\) - vec2\(focus - 0\.052, 0\.42\)\) \/ 0\.1/);
    expect(source).toMatch(/pu = vec2\(\(g\.x - focus \+ 1\.0\) \/ 1\.44, \(g\.y - 0\.07\) \/ 0\.38\)/);
    expect(source).toMatch(/mirror\(\(x0 - gap \+ 0\.9\) \/ 2\.56\)[\s\S]*mirror\(\(x2 - gap \+ 0\.9\) \/ 2\.56\)/);
    for (const name of Object.keys(TILES) as TileName[]) if (name !== "marker") expect(source, name).toContain(`tile(${tileVec(name)},`);
    expect(source.match(/texture2D\(u_layer/g)).toHaveLength(2);
    expect(source).toMatch(/float have = texture2D\(u_layer, vec2\(0\.997, 0\.003\)\)\.a;/);
    expect(source).toMatch(/float pond = mix\(smoothstep\(1\.0, 0\.985, length\(pd\)\), smoothstep\(0\.42, 0\.58, mk\.r\), have\);/);
    expect(source).toMatch(/vec3 tone\(vec4 t\) \{[^}]*amb \* 0\.9 \+ sun \* \(0\.28 \+ 0\.62 \* l\)/);
    expect(source).toMatch(/vec3 shadow = mix\(vec3\(1\.0\), vec3\(0\.5, 0\.58, 0\.74\), [^;]*dapple[^;]* \* day \* \(1\.0 - 0\.6 \* cloud\)\);/);
    expect(source).toMatch(/gap = u_clear\.x \/ u_resolution\.x \* aspect/);
    expect(source).toMatch(/lamp = night \* [^;]*\+ u_needsYou \* \(0\.9 \+ 0\.5 \* sin\(u_time \* 2\.4\)\)/);
    expect(source).toMatch(/glint \+= \(r\.w > 1\.5 \? u_errorColor : u_finishedColor\) \* live/);
    expect(source).toMatch(/vec2 lp = vec2\(lo \+ reach \* \(1\.0 \+ cos\(a\)[\s\S]*col = mix\(col, paper, body\);/);
    expect(source).toMatch(/float ice = [^;]* \* winter;/);
    expect(source).toMatch(/if \(u_weather\.y > 0\.0\) \{/);
    expect(source).toMatch(/mix\(mix\(vec3\(0\.03, 0\.04, 0\.07\), u_palette\[0\], day\), col, u_intensity\)/);
    expect(KYOTO_GARDEN.scene.backdrop.modes).toEqual({ light: { dark: "#383838", light: "#ffffff" }, dark: { dark: "#05070d", light: "#bcbcbc" } });
    const light = resolveLook(KYOTO_GARDEN, KYOTO_GARDEN.defaults, "light");
    const dark = resolveLook(KYOTO_GARDEN, KYOTO_GARDEN.defaults, "dark");
    expect(KYOTO_GARDEN.glass!.modes).toEqual({ light: { sidebar: { opacity: 0.56, blur: 14 }, transcript: { opacity: 0.7, blur: 14 }, composer: { opacity: 0.86, blur: 16 } } });
    expect([light.alpha.sidebar, light.alpha.transcript, light.alpha.composer, light.blur.transcript]).toEqual([0.56, 0.7, 0.86, 14]);
    expect(dark.blur.transcript).toBe(6);
    expect(dark.alpha.transcript).toBeLessThanOrEqual(0.25);
    expect(resolveLook({ ...KYOTO_GARDEN, scene: { ...KYOTO_GARDEN.scene, backdrop: { dark: "#05070d", light: "#ffffff" } } }, { ...KYOTO_GARDEN.defaults, glass: 0 }, "light").alpha.transcript).toBeGreaterThan(resolveLook(KYOTO_GARDEN, { ...KYOTO_GARDEN.defaults, glass: 0 }, "light").alpha.transcript);
    expect(KYOTO_GARDEN.effects.worker.character).toBe("paper lantern floating on the pond");
    expect(KYOTO_GARDEN.credit).toEqual(FOREST.credit);
    expect(KYOTO_GARDEN.scene.source.length).toBeLessThanOrEqual(24_000);
  });

  it("declares every uniform Forest's clock and weather feed sets, and credits its weather source", () => {
    if (FOREST.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    expect(Object.keys(FOREST.scene.uniforms).sort()).toEqual(Object.keys(forestUniforms(new Date(0), null)).sort());
    expect(FOREST.credit).toEqual({ source: "https://open-meteo.com/", license: "CC BY 4.0", copyright: "Weather data by Open-Meteo.com" });
  });
});
