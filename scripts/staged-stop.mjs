/** Stop must succeed and owned processes and listeners must disappear before deletion. */
export async function confirmStopped({ stop, processes, portsFree, sleep, timeoutMs = 10000 }) {
  await stop();
  const deadline = Date.now() + timeoutMs;
  do {
    if ((await processes()).length === 0 && await portsFree()) return;
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error("Staged processes or listeners are still running; keeping the instance directory and launcher.log.");
}
