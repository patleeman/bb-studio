import { MAX_ARTIFACT_BYTES, baseName, mimeFor } from "../shared";

export function importedFile(input: { name: string; mime: string; bytes: string }) {
  const name = baseName(input.name.trim());
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) throw new Error("Give the file a name.");
  if (input.bytes.length > 4 * Math.ceil(MAX_ARTIFACT_BYTES / 3)) throw new Error("Files must be at most 25 MB.");
  if (input.bytes.length % 4 !== 0) throw new Error("Invalid file data.");
  const padding = input.bytes.endsWith("==") ? 2 : input.bytes.endsWith("=") ? 1 : 0;
  if (input.bytes.length / 4 * 3 - padding > MAX_ARTIFACT_BYTES) throw new Error("Files must be at most 25 MB.");
  const bytes = Buffer.from(input.bytes, "base64");
  if (bytes.toString("base64") !== input.bytes) throw new Error("Invalid file data.");
  if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error("Files must be at most 25 MB.");
  const guessed = mimeFor(name);
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(input.mime) ? input.mime : "application/octet-stream";
  return { name, mime: guessed === "application/octet-stream" ? mime : guessed, bytes: new Uint8Array(bytes) };
}
