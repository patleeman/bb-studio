// A streaming ZIP writer and a validating reader for Studio backups
// (docs/backup.md). Files stream from disk to disk, so a backup with hours of
// audio never sits in memory. Plain ZIP (no ZIP64): one archive holds at most
// 65,535 files and 4 GiB.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as zlib from "node:zlib";

const MAX_UINT32 = 0xffffffff;
const MAX_ENTRIES = 65_535;

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** CRC-32 continued over `bytes`; node's own when it has one. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  const native = (zlib as { crc32?: (data: Uint8Array, value?: number) => number }).crc32;
  if (native) return native(bytes, previous) >>> 0;
  let crc = (previous ^ MAX_UINT32) >>> 0;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ MAX_UINT32) >>> 0;
}

/** Already-compressed formats are stored, not deflated again. */
const STORED = /\.(webm|ogg|oga|opus|m4a|mp3|mp4|aac|wav|flac|png|jpe?g|gif|webp|avif|zip|gz|tgz|br|zst|pdf)$/i;

/** Every file under `dir`, as sorted `/`-separated relative paths. */
export async function listFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (rel: string) => {
    const entries = await readdir(join(dir, rel), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) found.push(path);
    }
  };
  await walk("");
  return found;
}

/**
 * Zips every file under `dir` into `out`, `first` first (the manifest). Writes
 * to a temporary file and renames it into place, so a failure never leaves a
 * partial archive under the requested name.
 */
export async function zipDirectory(dir: string, out: string, first?: string): Promise<{ files: number; bytes: number }> {
  const names = await listFiles(dir);
  if (first && names.includes(first)) names.splice(names.indexOf(first), 1), names.unshift(first);
  if (names.length > MAX_ENTRIES) throw new Error(`A backup holds at most ${MAX_ENTRIES} files; this one has ${names.length}.`);
  await mkdir(dirname(out), { recursive: true });
  const temp = `${out}.${process.pid}.${Date.now()}.partial`;
  const handle = await open(temp, "wx");
  let offset = 0;
  const write = async (bytes: Uint8Array) => {
    await handle.write(bytes);
    offset += bytes.byteLength;
    if (offset > MAX_UINT32) throw new Error("This backup is larger than 4 GiB, which the backup format can't hold yet.");
  };
  const central: Buffer[] = [];
  try {
    for (const name of names) {
      const nameBytes = Buffer.from(name, "utf8");
      const method = STORED.test(name) ? 0 : 8;
      const headerOffset = offset;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      // UTF-8 names; sizes follow the data in a descriptor.
      local.writeUInt16LE(0x0808, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(nameBytes.length, 26);
      await write(local);
      await write(nameBytes);
      let crc = 0;
      let size = 0;
      let compressed = 0;
      const tap = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          crc = crc32(chunk, crc);
          size += chunk.length;
          done(null, chunk);
        },
      });
      const sink = async (source: AsyncIterable<Buffer>) => {
        for await (const chunk of source) {
          compressed += chunk.length;
          await write(chunk);
        }
      };
      const input = createReadStream(join(dir, ...name.split("/")));
      if (method === 8) await pipeline(input, tap, zlib.createDeflateRaw(), sink);
      else await pipeline(input, tap, sink);
      if (size > MAX_UINT32) throw new Error(`${name} is larger than 4 GiB, which the backup format can't hold yet.`);
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed, 8);
      descriptor.writeUInt32LE(size, 12);
      await write(descriptor);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(0x0808, 8);
      entry.writeUInt16LE(method, 10);
      entry.writeUInt32LE(crc, 16);
      entry.writeUInt32LE(compressed, 20);
      entry.writeUInt32LE(size, 24);
      entry.writeUInt16LE(nameBytes.length, 28);
      entry.writeUInt32LE(headerOffset, 42);
      central.push(entry, nameBytes);
    }
    const directoryOffset = offset;
    const directory = Buffer.concat(central);
    await write(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(names.length, 8);
    end.writeUInt16LE(names.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(directoryOffset, 16);
    await write(end);
    await handle.sync();
    await handle.close();
    if (await stat(out).catch(() => null)) throw new Error(`${out} already exists; a backup never overwrites another.`);
    await rename(temp, out);
    return { files: names.length, bytes: offset };
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temp, { force: true });
    throw error;
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export interface ZipLimits {
  /** Largest total of every file's size once extracted. */
  maxTotalBytes: number;
  maxEntries: number;
}

export const DEFAULT_LIMITS: ZipLimits = { maxTotalBytes: 8 * 1024 ** 3, maxEntries: MAX_ENTRIES };

/**
 * Whether a name in the archive is a plain relative path: no absolute paths,
 * drive letters, backslashes, `..`, `.`, empty or control-character segments.
 */
export function safeEntryName(name: string): boolean {
  if (!name || name.length > 500 || name.startsWith("/") || name.includes("\\") || /^[A-Za-z]:/.test(name)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  const parts = name.replace(/\/$/, "").split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error("This backup file is cut short.");
  return buffer;
}

/** Reads and checks an archive's directory before anything is extracted. */
export async function readZip(file: string, limits: ZipLimits = DEFAULT_LIMITS): Promise<ZipEntry[]> {
  const handle = await open(file, "r");
  try {
    const { size: fileSize } = await handle.stat();
    if (fileSize < 22) throw new Error("This isn't a backup file: it's too small to be a ZIP archive.");
    const tailLength = Math.min(fileSize, 22 + 65_535);
    const tail = await readAt(handle, fileSize - tailLength, tailLength);
    let end = -1;
    for (let index = tail.length - 22; index >= 0; index--) {
      if (tail.readUInt32LE(index) === 0x06054b50) { end = index; break; }
    }
    if (end < 0) throw new Error("This isn't a backup file: no ZIP directory found.");
    const count = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (count === 0xffff || directorySize === MAX_UINT32 || directoryOffset === MAX_UINT32) throw new Error("ZIP64 archives aren't supported.");
    if (count > limits.maxEntries) throw new Error(`This backup has ${count} files; at most ${limits.maxEntries} are allowed.`);
    const endOffset = fileSize - tailLength + end;
    if (directoryOffset + directorySize > endOffset) throw new Error("This backup file is damaged: its directory is out of range.");
    const directory = await readAt(handle, directoryOffset, directorySize);
    const entries: ZipEntry[] = [];
    const seen = new Set<string>();
    let total = 0;
    let at = 0;
    for (let index = 0; index < count; index++) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== 0x02014b50) throw new Error("This backup file is damaged: bad directory entry.");
      const flags = directory.readUInt16LE(at + 8);
      const method = directory.readUInt16LE(at + 10);
      const crc = directory.readUInt32LE(at + 16);
      const compressedSize = directory.readUInt32LE(at + 20);
      const size = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const offset = directory.readUInt32LE(at + 42);
      const name = directory.subarray(at + 46, at + 46 + nameLength).toString("utf8");
      at += 46 + nameLength + extraLength + commentLength;
      if (!safeEntryName(name)) throw new Error(`Refusing unsafe path in backup: ${JSON.stringify(name.slice(0, 120))}`);
      if (flags & 1) throw new Error(`Encrypted files aren't supported: ${name}`);
      if (name.endsWith("/")) continue;
      if (method !== 0 && method !== 8) throw new Error(`Unsupported compression in backup: ${name}`);
      if (method === 0 && size !== compressedSize) throw new Error(`This backup file is damaged: ${name}`);
      if (seen.has(name)) throw new Error(`Duplicate file in backup: ${name}`);
      seen.add(name);
      if (offset + 30 + compressedSize > directoryOffset) throw new Error(`This backup file is damaged: ${name} is out of range.`);
      // A file that inflates over 1000x and past 64 MB is a ZIP bomb, not a backup.
      if (size > 64 * 1024 ** 2 && size > compressedSize * 1000) throw new Error(`Refusing suspicious compression ratio: ${name}`);
      total += size;
      if (total > limits.maxTotalBytes) throw new Error(`This backup unpacks to more than ${Math.round(limits.maxTotalBytes / 1024 ** 3)} GiB.`);
      entries.push({ name, method, crc, compressedSize, size, offset });
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/** Where an entry's data starts, from its local header. */
async function dataStart(handle: FileHandle, entry: ZipEntry): Promise<number> {
  const header = await readAt(handle, entry.offset, 30);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`This backup file is damaged: ${entry.name}`);
  return entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
}

/** An entry's bytes, for small files such as the manifest. */
export async function readEntry(file: string, entry: ZipEntry, maxBytes = 16 * 1024 ** 2): Promise<Buffer> {
  if (entry.size > maxBytes) throw new Error(`${entry.name} is too large.`);
  const handle = await open(file, "r");
  try {
    const start = await dataStart(handle, entry);
    const raw = entry.compressedSize ? await readAt(handle, start, entry.compressedSize) : Buffer.alloc(0);
    const bytes = entry.method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) }) : raw;
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new Error(`This backup file is damaged: ${entry.name} fails its checksum.`);
    return bytes;
  } finally {
    await handle.close();
  }
}

/**
 * Extracts entries under `dest`, streaming each through its size and CRC
 * checks into a temporary file that's renamed into place once it passes.
 */
export async function extractEntries(file: string, entries: readonly ZipEntry[], dest: string): Promise<void> {
  const root = resolve(dest);
  const handle = await open(file, "r");
  try {
    for (const entry of entries) {
      const target = resolve(root, ...entry.name.split("/"));
      const back = relative(root, target);
      if (!back || back.startsWith("..") || isAbsolute(back) || back.split(sep).includes("..")) throw new Error(`Refusing unsafe path in backup: ${entry.name}`);
      await mkdir(dirname(target), { recursive: true });
      const start = await dataStart(handle, entry);
      const temp = `${target}.partial`;
      let crc = 0;
      let size = 0;
      const check = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          if (size > entry.size) return done(new Error(`This backup file is damaged: ${entry.name} is larger than it says.`));
          crc = crc32(chunk, crc);
          done(null, chunk);
        },
      });
      try {
        if (entry.compressedSize === 0) {
          await pipeline(async function* () {}, check, createWriteStream(temp, { flags: "wx" }));
        } else {
          const input = createReadStream(file, { start, end: start + entry.compressedSize - 1 });
          if (entry.method === 8) await pipeline(input, zlib.createInflateRaw(), check, createWriteStream(temp, { flags: "wx" }));
          else await pipeline(input, check, createWriteStream(temp, { flags: "wx" }));
        }
        if (size !== entry.size || crc !== entry.crc) throw new Error(`This backup file is damaged: ${entry.name} fails its checksum.`);
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    }
  } finally {
    await handle.close();
  }
}

/** The total size of the files under `dir`. */
export async function directorySize(dir: string): Promise<number> {
  let total = 0;
  for (const name of await listFiles(dir)) total += (await stat(join(dir, ...name.split("/")))).size;
  return total;
}
