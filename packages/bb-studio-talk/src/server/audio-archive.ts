/** A plain tar archive keeps each recorded segment in order without transcoding it. */
export function audioArchive(segments: readonly { name: string; bytes: Uint8Array }[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const field = (header: Uint8Array, offset: number, length: number, value: string) => {
    header.set(new TextEncoder().encode(value).slice(0, length - 1), offset);
  };
  for (const segment of segments) {
    const header = new Uint8Array(512);
    field(header, 0, 100, segment.name);
    field(header, 100, 8, "0000644");
    field(header, 108, 8, "0000000");
    field(header, 116, 8, "0000000");
    field(header, 124, 12, segment.bytes.length.toString(8).padStart(11, "0"));
    field(header, 136, 12, "00000000000");
    header.fill(32, 148, 156);
    header[156] = 48;
    field(header, 257, 6, "ustar");
    field(header, 263, 2, "00");
    const sum = header.reduce((total, byte) => total + byte, 0);
    field(header, 148, 8, sum.toString(8).padStart(6, "0"));
    blocks.push(header, segment.bytes);
    const padding = (512 - (segment.bytes.length % 512)) % 512;
    if (padding) blocks.push(new Uint8Array(padding));
  }
  blocks.push(new Uint8Array(1024));
  const archive = new Uint8Array(blocks.reduce((size, block) => size + block.length, 0));
  let offset = 0;
  for (const block of blocks) { archive.set(block, offset); offset += block.length; }
  return archive;
}
