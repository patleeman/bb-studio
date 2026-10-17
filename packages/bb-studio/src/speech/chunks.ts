// Long text is spoken in pieces, cut at sentence ends, so the first piece
// plays while the rest are still being made. The first piece is kept short
// to start sooner; later ones are longer, which sounds more even.

const FIRST_MAX = 200;
const REST_MAX = 600;

/** Sentences, keeping their end punctuation; a sentence with no break stays whole. */
function sentences(text: string): string[] {
  return text.match(/[^.!?…\n]+(?:[.!?…]+["')\]]*|\n+|$)/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
}

/** Cut an over-long sentence at commas or spaces. */
function cut(sentence: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const at = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "));
    const end = at > max / 3 ? at + 1 : window.lastIndexOf(" ") > max / 3 ? window.lastIndexOf(" ") : max;
    pieces.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  const max = () => (chunks.length === 0 ? FIRST_MAX : REST_MAX);
  for (const sentence of sentences(text.replace(/\s*\n\s*/g, "\n"))) {
    for (const piece of cut(sentence, max())) {
      if (current && current.length + 1 + piece.length > max()) {
        chunks.push(current);
        current = piece;
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
