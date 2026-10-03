/** Fixed-height spreadsheet rows, with an open editor kept mounted offscreen. */
export function visibleRows(count: number, scrollTop: number, height: number, rowHeight: number, pinned: number[] = []): number[] {
  if (count <= 100) return Array.from({ length: count }, (_, index) => index);
  const first = Math.min(count - 1, Math.max(0, Math.floor(scrollTop / rowHeight)));
  const start = Math.max(0, first - 8);
  const end = Math.min(count, first + Math.ceil(height / rowHeight) + 9);
  return [...new Set([...Array.from({ length: end - start }, (_, index) => start + index), ...pinned.filter(index => index >= 0 && index < count)])].sort((a, b) => a - b);
}

/** Keep the target below the sticky heading without scrolling any ancestor. */
export function scrollToRow(index: number, scrollTop: number, height: number, rowHeight: number, headerHeight: number): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight + headerHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + height) return Math.max(0, bottom - height);
  return scrollTop;
}
