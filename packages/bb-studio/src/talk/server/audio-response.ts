/** Single-range responses let browsers seek within a recorded audio segment. */
export function audioResponse(bytes: Uint8Array, mimeType: string, range?: string, downloadName?: string): Response {
  const headers: Record<string, string> = {
    "content-type": mimeType.split(";")[0]!,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    ...(downloadName ? { "content-disposition": `attachment; filename="${downloadName}"` } : {}),
  };
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  // Ignore unsupported range formats, including multipart ranges.
  if (!match) return new Response(bytes as BodyInit, { headers: { ...headers, "content-length": String(bytes.length) } });
  const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
  if ((!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${bytes.length}` } });
  }
  return new Response(bytes.slice(start, end + 1) as BodyInit, { status: 206, headers: {
    ...headers, "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": String(end - start + 1),
  } });
}
