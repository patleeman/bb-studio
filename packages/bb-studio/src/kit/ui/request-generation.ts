/** Only the newest request may publish its result, including errors. */
export function requestGeneration() {
  let generation = 0;
  return {
    begin() {
      const request = ++generation;
      return () => request === generation;
    },
    invalidate() { generation++; },
  };
}
