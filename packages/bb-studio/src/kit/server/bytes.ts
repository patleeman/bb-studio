/** Serve private immutable content with consistent browser safety headers. */
export function serveBytes(
  body: BodyInit,
  headers: Record<string, string>,
): Response {
  return new Response(body, {
    headers: {
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}
