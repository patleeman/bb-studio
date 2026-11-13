# Theme credits

The classic themes in `src/theme/builtin/classic.ts` use these projects' published palettes. Each is MIT licensed. The hex values were read from the sources below on 2026-11-11.

| Theme | Source | License | Copyright |
|---|---|---|---|
| Classic (bb's default look) | https://github.com/get-bb/bb (`apps/app/src/components/ui/theme.css`; oklch tokens converted to hex) | MIT | Copyright (c) 2026 Michael Yong |
| One Dark | https://github.com/atom/atom/tree/master/packages/one-dark-syntax (`styles/colors.less`); sidebar from `packages/one-dark-ui` (`@level-3-color`) | MIT | Copyright (c) 2016 GitHub Inc. (one-dark-syntax); Copyright (c) 2014 GitHub Inc. (one-dark-ui) |
| Dracula | https://draculatheme.com/spec; sidebar `BGDark` from https://github.com/dracula/visual-studio-code | MIT | Copyright (c) 2023 Dracula Theme (dracula-theme); Copyright (c) 2016 Dracula Theme (visual-studio-code) |
| Solarized Light | https://github.com/altercation/solarized | MIT | Copyright (c) 2011 Ethan Schoonover |
| GitHub Light | https://github.com/primer/github-vscode-theme ("GitHub Light Default") | MIT | Copyright (c) 2020 Primer |
| GitHub Dark | https://github.com/primer/github-vscode-theme ("GitHub Dark Default") | MIT | Copyright (c) 2020 Primer |
| Nord | https://github.com/nordtheme/nord (`src/nord.css`) | MIT | Copyright (c) 2016-present Sven Greb |
| Catppuccin Mocha | https://github.com/catppuccin/palette (`palette.json`, v1.8.0) | MIT | Copyright (c) 2021 Catppuccin |

## Changes from the published palettes

- One Dark: the palette is published in HSL; the hex values are converted.
- Solarized Light: the body text is base01 (`#586e75`), not base00, and the sidebar is base3, not base2. base00 on base3, and base01 on base2, are below 4.5:1.
- All themes: muted text, error, warning and success text are mixed toward the theme's text color at run time until they reach 4.5:1 (3:1 for success and accent) on every surface (`src/theme/look.ts`). The fills keep the published colors.

## Scene themes

Miami 1985, Event Horizon, Grid, Kyoto Garden, Forest, Aurora Fjord, Tonight's Sky and Data City are drawn by their own shaders in `src/theme/builtin/`. Miami 1985, Event Horizon, Grid and Forest take their palettes from Studio's design mockups (round 8, screens 8a to 8c and 8e); Kyoto Garden's scene, dark variant and season, light and variant logic were written for it from a text brief (it replaces Zen Garden and keeps that theme's light variant, glass and fonts, from mockup 8d); its Sun elevation and weather are Forest's (Open-Meteo, credited in the package), its Moon phase is the mean synodic month counted from the new moon of 2000-01-06 18:14 UTC, and it uses no image, texture or outside shader; Aurora Fjord's palette and scene were written for it from a text brief (it replaces Cabin Aurora and keeps that theme's palette, glass and fonts). Its aurora is Studio's own method: the sight line is stepped through 13 heights of a folded sheet pattern and each crossing of a sheet is added once, at the height where it is crossed. Grid's skylines, ring and mirrored floor were written for it too. Tonight's Sky's palette and shader were written for it from a text brief too; its star positions, constellation figures and ephemeris come from the outside sources in the table. Data City's palette, scene and glyph set were written for it from a text brief; it shows single glyphs and no words (`src/theme/data-city/atlas.ts`), and its glyphs are drawn at run time with the system's monospace font, so no font file or image is bundled. No other published palette, image, shader or outside work is used or bundled. Their fonts are in the Fonts section below.

| Theme | Source | License | Credit |
|---|---|---|---|
| Forest weather | https://open-meteo.com/ (Forecast API `current=weather_code,cloud_cover,temperature_2m`, Geocoding API for a city) | Data CC BY 4.0; free, no API key, non-commercial use | Weather data by Open-Meteo.com |
| Forest place | The tz database (`/usr/share/zoneinfo/zone1970.tab` or `zone.tab` on this computer) | Public domain | Coordinates of the computer's time zone, rounded to 0.1° |
| Tonight's Sky ephemeris (Sun, Moon and its phase, planets, sidereal rotation, eclipses) | Astronomy Engine 2.1.19, https://github.com/cosinekitty/astronomy (npm `astronomy-engine`) | MIT | Copyright (c) 2019-2023 Don Cross |
| Tonight's Sky stars (2,887 stars to magnitude 5.5: J2000 position, V magnitude, B−V color) | Yale Bright Star Catalogue, 5th Revised Ed. (Preliminary Version), Hoffleit D., Warren Jr W.H., 1991: http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz (the ADC/CDS catalog V/50) | Public domain; no copyright is claimed on the catalog | Hoffleit and Warren, Yale University Observatory; distributed by the Astronomical Data Center (NSSDC/ADC) |
| Tonight's Sky constellation lines, names and label spots (89 figures; Serpens has two) | d3-celestial, https://github.com/ofrohn/d3-celestial (`data/constellations.lines.json`, `data/constellations.json`, commit `7e720a3`) | BSD-3-Clause | Copyright (c) 2015, Olaf Frohn. All rights reserved. |
| Tonight's Sky meteor showers (12 showers: peak solar longitude, radiant, zenithal hourly rate) | The International Meteor Organization's working list of visual meteor showers, https://www.imo.net/resources/calendar/ | Facts typed in by hand; no file is bundled | International Meteor Organization |

## Methods

- Event Horizon traces light through a Schwarzschild black hole. Each ray from the camera is stepped with the photon orbit equation in Cartesian form, `a = -3/2 · h² · x / r⁵` (Schwarzschild radius 1, `h = |x × v|`), which gives the same path as the Binet equation `u'' + u = 3Mu²`. The step is 0.12·r, so a pixel takes more steps near the hole and none when its ray misses the 18 r_s sphere; outside that sphere the weak-field angle `2 r_s / b` bends the ray. The disk runs from the innermost stable orbit (3 r_s) to 16 r_s with the Novikov–Thorne flux profile `F ∝ r⁻³(1 − √(r_in/r))`, temperature `T ∝ F^¼`, Keplerian speed `β = √(M/(r − 2M))`, and the shift `g = √(1 − r_s/r) / (γ(1 − β·n))`. Observed temperature is `g·T` and brightness `g⁴·F`, so the approaching side is brighter and bluer.
- Data City steps each sight line through a grid of city blocks (one tower a block, at most 24 blocks), keeps the first two tower faces it meets and blends them front to back, so a tower shows faintly through the one before it. The avenue is two blocks wide with a tower on every block of both sides, each at least twice the camera's height, and a cross avenue cuts it every fourth block. The city repeats every 16 blocks and every moving part is a whole number of cycles of one 56-second turn (`u_period`), so the loop has no seam. Glyphs come from a 1024-pixel atlas (`u_layer`) that `src/theme/data-city/driver.ts` paints once: 128 glyph cells. A face whose glyphs would be under about 4 pixels wide is drawn as plain columns, and a theme without the atlas (a stored copy, a picker preview) gets block glyphs made in the shader.
- Tonight's Sky bundles its catalog offline. `node scripts/theme-sky-catalog.mjs <bsc5.dat> <constellations.lines.json> <constellations.json>` writes `src/theme/tonight/catalog-data.ts` (36,501 bytes: 6 bytes a star as base64, and the line vertices in hundredths of a degree) from the three downloaded files; nothing is fetched at run time. SHA-256 of the files read on 2026-11-11: `bsc5.dat.gz` `0471ced0…6036cdb`, `constellations.lines.json` `294f66be…373e13c`, `constellations.json` `ab4ae692…55d4d8b2`. Tree-shaken and minified, Astronomy Engine adds about 62 KB to the app bundle and to the server bundle (27 KB gzipped); with the catalog, the shader and the theme's own code the app bundle grows about 120 KB (60 KB gzipped). The BSD-3-Clause notice for the constellation data, as its license requires: "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."
- Tonight's Sky places every star with Astronomy Engine's rotation from J2000 equatorial to the observer's horizon (`Rotation_EQJ_HOR`: precession, nutation and sidereal time), and the Sun, Moon and planets with their topocentric positions. No refraction is applied. The view is a stereographic projection: the camera is pitched 14° up, the horizon sits 10% up the window and 70° of altitude reaches the top, about 120° wide in a 16:10 window. With nothing bright up it faces south (north below the equator). Otherwise it turns up to 100° away from the Moon (once it is 6° up), or the brightest planet at least 10° up and magnitude 1.5 or brighter, so that body sits in the strip right of the transcript column; when turning alone would lift the body out of the window, the projection's center moves toward the strip. While the Sun is higher than −10° the scene shows the coming nightfall. Stars near the horizon are dimmed (extinction), the Milky Way follows the galactic plane (pole 192.86°, +27.13°; center 266.40°, −28.94°), the Moon's lit side faces the Sun at its real phase angle, and a lunar eclipse (`SearchLunarEclipse`) reddens it by how deep in the umbra it is.
- Tonight's Sky's meteor rate: each shower's hourly rate is `ZHR · 10^(−slope · |λ☉ − λpeak|)` in degrees of solar longitude (J2000, so a peak lands on the same sky date every year), times the sine of the radiant's altitude. Showers under 1.5 an hour are not active. The shader draws 1 to 6 meteor slots, `1 + round(visible per hour / 3)`: one slot on a quiet night, 4 to 5 near the Leonid peak (2026-11-17), 6 for the Perseids and Geminids. All but the first slot's meteors point away from the strongest shower's radiant. The slopes are rough fits to the showers' published activity curves, not IMO values.
- Forest's sun is placed with the low-precision solar coordinates of the Astronomical Almanac (accurate to about 0.01° between 1950 and 2050): day above 6°, night below −6°, dawn or dusk in between. With no place, the clock stands in: sunrise at 6:30, sunset at 18:30.

## Fonts

### Bundled

| Font | File | Size | Source | License | Copyright |
|---|---|---|---|---|---|
| Jost (variable, weight 100 to 900, upright, Latin subset) | `src/theme/fonts/Jost-latin.woff2` | 26,588 bytes (35,452 as base64 in the app bundle) | https://github.com/indestructible-type/Jost; the Latin subset is the file Google Fonts serves (`https://fonts.gstatic.com/s/jost/v20/92zatBhPNqw73oTd4jQmfxI.woff2`, built from `ofl/jost` in https://github.com/google/fonts) | SIL Open Font License 1.1 (`src/theme/fonts/Jost-OFL.txt`) | Copyright 2020 The Jost Project Authors (https://github.com/indestructible-type) |

The plugin build makes one `app.js` and has no static asset folder, so the font is embedded as base64 in `src/theme/fonts/data.ts`. `node scripts/theme-fonts.mjs` writes that file from the `.woff2` files; a test fails when the two differ. The `@font-face` rule is added to the page the first time a theme whose stacks name the family is shown (`loadBundledFonts` in `src/theme/fonts.ts`), with `font-display: swap`. No font is fetched from a network.

### What each stack renders

Checked on 2026-11-11 on macOS 26.6.2 with `system_profiler SPFontsDataType`, the files in `/System/Library/Fonts`, and headless Chrome (text measured against a fallback at weights 400 to 800). The transcript uses the body stack unless a row says otherwise.

| Theme | Role | First face | Installed | What renders |
|---|---|---|---|---|
| Miami 1985 | heading | Jost | Bundled | Jost at 500 |
| Miami 1985 | body | -apple-system | System font | SF Pro |
| Miami 1985 | mono | ui-monospace | System font | SF Mono |
| Event Horizon | heading | Avenir Next | Yes (`/System/Library/Fonts/Avenir Next.ttc`, 12 styles) | Avenir Next Demi Bold (600) |
| Event Horizon | body | -apple-system | System font | SF Pro |
| Event Horizon | mono | ui-monospace | System font | SF Mono |
| Grid | heading | DIN Alternate | Yes (`/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf`, Bold only) | DIN Alternate Bold (700) |
| Grid | body | -apple-system | System font | SF Pro |
| Grid | mono | ui-monospace | System font | SF Mono |
| Kyoto Garden | heading | Iowan Old Style | Yes (`/System/Library/Fonts/Supplemental/Iowan Old Style.ttc`; `system_profiler` does not list it, Chrome resolves it) | Iowan Old Style Bold (600) |
| Kyoto Garden | transcript | Iowan Old Style | Yes, as above | Iowan Old Style Roman, Bold for bold text |
| Kyoto Garden | body | -apple-system | System font | SF Pro |
| Kyoto Garden | mono | ui-monospace | System font | SF Mono |
| Forest | heading | Avenir Next | Yes | Avenir Next Demi Bold (600) |
| Forest | body | -apple-system | System font | SF Pro |
| Forest | mono | ui-monospace | System font | SF Mono |
| Aurora Fjord | heading | Optima | Yes (`/System/Library/Fonts/Optima.ttc`: Regular, Italic, Bold, Bold Italic, ExtraBlack) | Optima Bold (700) |
| Aurora Fjord | body | -apple-system | System font | SF Pro |
| Aurora Fjord | mono | ui-monospace | System font | SF Mono |
| Tonight's Sky | heading | Gill Sans | Yes (`/System/Library/Fonts/Supplemental/GillSans.ttc`: Light, Regular, SemiBold, Bold, UltraBold and italics) | Gill Sans SemiBold (600) |
| Tonight's Sky | body | -apple-system | System font | SF Pro |
| Tonight's Sky | mono | ui-monospace | System font | SF Mono |
| Data City | heading, mono | ui-monospace | System font | SF Mono SemiBold (600) for headings |
| Data City | body | -apple-system | System font | SF Pro |
| Data City | glyph atlas (canvas) | ui-monospace | System font | SF Mono SemiBold, else Menlo Bold |
| Template for agent-made themes | heading, body | -apple-system | System font | SF Pro, each heading at its own weight |
| Template for agent-made themes | mono | ui-monospace | System font | SF Mono |
| Classic, One Dark, Dracula, Solarized Light, GitHub Light, GitHub Dark, Nord, Catppuccin Mocha | heading, body | Inter Variable | Not a system font; bb ships it (`@fontsource-variable/inter`) | Inter Variable, each heading at its own weight |
| The same eight | mono | ui-monospace | System font | SF Mono |

Later names in the stacks, on this Mac: Futura (Medium, Medium Italic, Bold, two Condensed), Gill Sans, Avenir Next Condensed, Trebuchet MS, Arial Narrow, Palatino, Hoefler Text, Georgia, Menlo and Monaco are installed. Century Gothic, Eurostile and Bank Gothic are not. "SF Pro Text", "SF Pro Display" and "SF Mono" are not installed under those names; the stacks reach San Francisco through `-apple-system` and `ui-monospace`, which come first.

### Heading weight

A theme's optional `type.headingWeight` (100 to 900, in hundreds) sets the weight of every `h1`, `h2`, `h3` and `[data-studio-heading]` outside a transcript: the Bot's name, "Conversations", "Workers", page titles. A theme without it leaves each heading at its own weight. Headings inside a transcript (`[data-thread-window]`) keep the transcript's font and their own weight.

Before this field, Miami 1985's headings named Futura and asked for weight 600. Futura has Medium (500) and Bold (700) and nothing between, so 600 rendered Futura Bold. No font was missing.

| Theme | Heading weight | Mockup |
|---|---|---|
| Miami 1985 | 500 | 8a sets the Bot's name and the title in italic 800 with a chrome gradient, and section heads in italic 700 capitals. The theme uses 500 upright; the heavy italic is not built. |
| Event Horizon | 600 | 8b: 600 |
| Grid | 700 | 8c: 700 |
| Kyoto Garden | 600 | 8d: 600 (Zen Garden's, which it replaces) |
| Forest | 600 | 8e: 600 |
| Aurora Fjord | 700 | No mockup. Optima has Regular (400) and Bold (700) and nothing between, so the theme asks for 700. |
| Tonight's Sky | 600 | No mockup. Gill Sans has a SemiBold (600); headless Chrome measures 600 wider than 500 and narrower than 700. |
| Data City | 600 | No mockup. SF Mono has a Semibold (600). |
