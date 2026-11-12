import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "theme", "fonts");
const files = readdirSync(dir).filter((name) => name.endsWith(".woff2")).sort();
const lines = files.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(readFileSync(join(dir, name)).toString("base64"))},`);
writeFileSync(join(dir, "data.ts"), `export const FONT_DATA: Record<string, string> = {\n${lines.join("\n")}\n};\n`);
console.log(`${files.length} font file(s) written to src/theme/fonts/data.ts`);
