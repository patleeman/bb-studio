/** Leave the editor before deleting its fixture, including failed captures. */
export async function runCapture(client, setup, screenshot) {
  let cleanup;
  try {
    // The previous editor is gone, but its tabs still live in browser storage.
    // Restoring a deleted drawing on the next page can redirect that page back
    // to the library while a new dashboard is opening.
    await client.resetCaptureState();
    cleanup = await setup(client);
    await screenshot();
  } finally {
    await client.navigate("about:blank");
    if (cleanup) await cleanup();
  }
}
