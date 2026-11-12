/** Deterministic, readable cursor color per actor key. */
export function actorColor(key: string): string {
  const palette = ["#7c3aed", "#0891b2", "#db2777", "#16a34a", "#ea580c", "#2563eb", "#9333ea", "#0d9488"];
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length]!;
}
