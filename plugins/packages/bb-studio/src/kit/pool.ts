/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once,
 * returning results in input order. If any item rejects, no further items
 * are started, in-flight items are awaited to completion, and the
 * lowest-index failure is rethrown.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("mapPool concurrency must be a positive integer.");
  }
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  const errors = new Map<number, unknown>();
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (error) {
        failed = true;
        errors.set(index, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (errors.size) {
    const lowest = Math.min(...errors.keys());
    throw errors.get(lowest);
  }
  return results;
}
