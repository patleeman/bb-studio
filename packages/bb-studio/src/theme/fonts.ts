import { FONT_DATA } from "./fonts/data";

export interface BundledFont {
  family: string;
  file: string;
  licenseFile: string;
  weight: string;
  style: "normal" | "italic";
  unicodeRange: string;
  source: string;
  license: string;
  copyright: string;
}

const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

export const BUNDLED_FONTS: readonly BundledFont[] = [
  {
    family: "Jost",
    file: "Jost-latin.woff2",
    licenseFile: "Jost-OFL.txt",
    weight: "100 900",
    style: "normal",
    unicodeRange: LATIN,
    source: "https://github.com/indestructible-type/Jost",
    license: "OFL-1.1",
    copyright: "Copyright 2020 The Jost Project Authors (https://github.com/indestructible-type)",
  },
];

export const FONT_STYLE_ID = "studio-theme-fonts";

export function stackFamilies(stack: string): string[] {
  return stack.split(",").map((name) => name.trim().replace(/^["']|["']$/g, "").trim()).filter((name) => name.length > 0);
}

export function bundledFontsFor(stacks: readonly (string | undefined)[]): BundledFont[] {
  const named = new Set(stacks.flatMap((stack) => (stack ? stackFamilies(stack) : [])));
  return BUNDLED_FONTS.filter((font) => named.has(font.family));
}

export function fontFaceCss(fonts: readonly BundledFont[]): string {
  return fonts.map((font) => {
    const data = FONT_DATA[font.file];
    if (!data) throw new Error(`The font file ${font.file} is not bundled.`);
    return `@font-face { font-family: "${font.family}"; font-style: ${font.style}; font-weight: ${font.weight}; font-display: swap; src: url(data:font/woff2;base64,${data}) format("woff2"); unicode-range: ${font.unicodeRange}; }`;
  }).join("\n");
}

export function loadBundledFonts(doc: Document, stacks: readonly (string | undefined)[]): void {
  const wanted = bundledFontsFor(stacks);
  if (wanted.length === 0) return;
  let style = doc.getElementById(FONT_STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = FONT_STYLE_ID;
    doc.head.appendChild(style);
  }
  const loaded = new Set((style.getAttribute("data-fonts") ?? "").split(",").filter((file) => file.length > 0));
  const missing = wanted.filter((font) => !loaded.has(font.file));
  if (missing.length === 0) return;
  style.textContent = [style.textContent ?? "", fontFaceCss(missing)].filter((css) => css.length > 0).join("\n");
  style.setAttribute("data-fonts", [...loaded, ...missing.map((font) => font.file)].join(","));
}
