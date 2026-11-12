export const ATLAS = {
  size: 1024,
  columns: 16,
  rows: 8,
  cellWidth: 64,
  cellHeight: 96,
} as const;

export const GLYPH_ROWS: readonly string[] = [
  "0123456789ABCDEF",
  "F0E1D2C3B4A59687",
  "0123456789ABCDEF",
  "8A9B0C1D2E3F4567",
  "0123456789.:/+-=",
  "GHJKLMNPRSTUVWXZ",
  "<>[]{}#%*&$@!?^~",
  "01 10 0 1 11 0  ",
];

export const ATLAS_FACE = `ui-monospace, "SF Mono", Menlo, monospace`;
export const GLYPH_FONT = `600 72px ${ATLAS_FACE}`;

export interface AtlasContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
}

export interface AtlasMark { text: string; x: number; y: number; maxWidth: number }

export function atlasMarks(): AtlasMark[] {
  const glyphs: AtlasMark[] = [];
  GLYPH_ROWS.forEach((line, row) => {
    for (let column = 0; column < ATLAS.columns; column += 1) {
      const text = line[column] ?? " ";
      if (text === " ") continue;
      glyphs.push({ text, x: (column + 0.5) * ATLAS.cellWidth, y: (row + 0.5) * ATLAS.cellHeight, maxWidth: ATLAS.cellWidth - 10 });
    }
  });
  return glyphs;
}

export function paintAtlas(context: AtlasContext): void {
  context.fillStyle = "#000000";
  context.fillRect(0, 0, ATLAS.size, ATLAS.size);
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = GLYPH_FONT;
  for (const mark of atlasMarks()) context.fillText(mark.text, mark.x, mark.y, mark.maxWidth);
}
