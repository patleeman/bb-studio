export function messageLinkPath(pathname: string, threadId: string, seq: number): string | null {
  const base = pathname.replace(/\/+$/, "");
  const match = /\/threads\/([^/]+)$/.exec(base);
  if (!match || decodeURIComponent(match[1]!) !== threadId) return null;
  return `${base}#msg=${seq}`;
}
