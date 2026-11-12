// A mini app's source, checked and compiled when it's saved.
//
// JSX, TypeScript and ES imports become CommonJS with Sucrase (a transform,
// not a bundler): each file turns into `require()` calls the frame's runtime
// resolves (src/minis/shelf/runtime.ts). Nothing is fetched or installed.
// Imports must name another file of the app or a module of a shelf lib the
// manifest lists, so a missing library fails here, not in the user's frame.
import { transform } from "sucrase";
import { LIMITS, parseManifest, resolveLibs, SHELF, type Manifest } from "../shared";

export type SourceFiles = Record<string, string>;

export interface Compiled {
  manifest: Manifest;
  /** Path → CommonJS module body, for every JS-like, JSON and CSS file. */
  modules: Record<string, string>;
  /** The HTML entry's text, when the entry is HTML. */
  html: string | null;
}

const PATH = /^(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.(?:jsx|tsx|js|ts|mjs|json|css|html|md|txt|svg)$/;
const CODE = /\.(?:jsx|tsx|js|ts|mjs)$/;

export class CompileError extends Error {}

/** `mini.json` from the files, or the defaults. */
export function manifestOf(files: SourceFiles): Manifest {
  const text = files["mini.json"];
  if (text === undefined) return parseManifest({});
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new CompileError(`mini.json isn't valid JSON: ${(error as Error).message}`);
  }
  try {
    return parseManifest(raw);
  } catch (error) {
    const issues = (error as { issues?: { path: (string | number)[]; message: string }[] }).issues;
    throw new CompileError(`mini.json: ${issues ? issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ") : (error as Error).message}`);
  }
}

export function checkFiles(files: SourceFiles) {
  const paths = Object.keys(files);
  if (paths.length === 0) throw new CompileError("A mini app needs at least one file.");
  if (paths.length > LIMITS.files) throw new CompileError(`At most ${LIMITS.files} files.`);
  let total = 0;
  for (const path of paths) {
    if (!PATH.test(path) || path.split("/").some((part) => part === ".." || part === ".")) throw new CompileError(`Bad file path "${path}": use relative paths like main.jsx or components/List.jsx.`);
    const text = files[path];
    if (typeof text !== "string") throw new CompileError(`${path}: file contents must be text.`);
    const bytes = Buffer.byteLength(text);
    if (bytes > LIMITS.fileBytes) throw new CompileError(`${path} is ${Math.ceil(bytes / 1024)} KB; a file may be ${LIMITS.fileBytes / 1024} KB.`);
    total += bytes;
  }
  if (total > LIMITS.sourceBytes) throw new CompileError(`The source is ${Math.ceil(total / 1024)} KB; a mini app may be ${LIMITS.sourceBytes / 1024 / 1024} MB.`);
}

const REQUIRE = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;
const EXTENSIONS = ["", ".jsx", ".tsx", ".js", ".ts", ".json", ".css", "/index.jsx", "/index.tsx", "/index.js", "/index.ts"];

function resolveLocal(files: SourceFiles, from: string, name: string): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const part of name.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  const base = parts.join("/");
  return EXTENSIONS.map((ext) => base + ext).find((path) => path in files) ?? null;
}

function compileCode(path: string, text: string): string {
  const ts = /\.tsx?$/.test(path);
  const jsx = /\.(?:jsx|tsx|js)$/.test(path);
  try {
    return transform(text, {
      transforms: [...(ts ? (["typescript"] as const) : []), ...(jsx ? (["jsx"] as const) : []), "imports"],
      jsxRuntime: "automatic",
      production: true,
      filePath: path,
    }).code;
  } catch (error) {
    throw new CompileError(`${path}: ${(error as Error).message}`);
  }
}

/** Checks and compiles every file. Throws CompileError with what to fix. */
export function compile(files: SourceFiles): Compiled {
  checkFiles(files);
  const manifest = manifestOf(files);
  if (!(manifest.entry in files)) throw new CompileError(`The entry ${manifest.entry} isn't one of the files (${Object.keys(files).join(", ")}). Set "entry" in mini.json.`);
  if (!/\.(?:html|jsx|tsx|js|ts|mjs)$/.test(manifest.entry)) throw new CompileError("The entry must be an HTML file or a JS, JSX, TS or TSX module.");
  const available = new Map<string, string>();
  for (const lib of SHELF) for (const name of lib.modules) available.set(name, lib.id);
  const loaded = new Set(resolveLibs(manifest.libs).map((lib) => lib.id));

  const modules: Record<string, string> = {};
  const problems: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (path === "mini.json") continue;
    if (CODE.test(path)) {
      const code = compileCode(path, text);
      for (const match of code.matchAll(REQUIRE)) {
        const name = match[2]!;
        if (name.startsWith(".") || name.startsWith("/")) {
          if (!resolveLocal(files, path, name)) problems.push(`${path} imports ${name}, which isn't one of the files.`);
          continue;
        }
        const lib = available.get(name);
        if (!lib) problems.push(`${path} imports "${name}", which isn't on the shelf. Use a shelf library (${SHELF.map((each) => each.id).join(", ")}), or copy the code into the app as its own file.`);
        else if (!loaded.has(lib)) problems.push(`${path} imports "${name}": add "${lib}" to "libs" in mini.json.`);
      }
      modules[path] = code;
    } else if (path.endsWith(".json")) {
      try {
        JSON.parse(text);
      } catch (error) {
        throw new CompileError(`${path} isn't valid JSON: ${(error as Error).message}`);
      }
      modules[path] = `module.exports = ${text};`;
    } else if (path.endsWith(".css")) {
      modules[path] = `var s = document.createElement("style"); s.setAttribute("data-file", ${JSON.stringify(path)}); s.textContent = ${JSON.stringify(text)}; document.head.appendChild(s);`;
    } else if (path.endsWith(".md") || path.endsWith(".txt") || path.endsWith(".svg")) {
      modules[path] = `module.exports = ${JSON.stringify(text)};`;
    }
  }
  if (problems.length) throw new CompileError(problems.join("\n"));
  return { manifest, modules, html: manifest.entry.endsWith(".html") ? files[manifest.entry]! : null };
}

/** The app's modules as one classic script for the frame: each file a `__mini.define` call. */
export function appScript(modules: Record<string, string>): string {
  return Object.entries(modules)
    .map(([path, code]) => `__mini.define(${JSON.stringify(path)}, function (require, module, exports) {\n${code}\n});`)
    .join("\n");
}
