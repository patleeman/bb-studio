// The Canvas plugin (prototype): its page after one real agent turn in the
// canvas's hidden BB thread, on the staged BB's default provider. The
// agent's board must hold a few items and its reply must be the caption.
const until = async (read, done, sleep, ms) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Visual Chat capture timed out; last: ${JSON.stringify(value).slice(0, 600)}`);
    await sleep(1000);
  }
};

export default ({ pluginRpc, sleep }) => [
  {
    id: "studio-visual-chat",
    packageDir: "bb-studio-visual-chat",
    privateSidebar: true,
    setup: async (client) => {
      const prompt = process.env.BB_CAPTURE_CANVAS_PROMPT ?? "Compare the populations of the five largest US cities, with a chart.";
      const { threadId } = await pluginRpc("studio-visual-chat", "canvas.create", { text: prompt });
      const canvas = await until(() => pluginRpc("studio-visual-chat", "canvas.get", { threadId }).then((result) => result.canvas), (view) => view?.status === "idle" && view.items.length >= 3 && !!view.caption, sleep, 8 * 60_000);
      await client.navigate(`/plugins/studio-visual-chat/canvas/${threadId}`);
      await client.waitForSelector("[data-canvas-board]");
      await until(() => client.poll(`document.querySelectorAll("[data-canvas-item]").length`), (count) => count >= 3, sleep, 15_000);
      await client.waitForText(canvas.caption.slice(0, 40));
      await sleep(2000);
    },
  },
];
