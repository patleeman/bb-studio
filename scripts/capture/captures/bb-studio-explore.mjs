import companions from "./explore-companions.mjs";

export default context => {
  const { projectId, threadId } = context;
  return [
  ...(process.env.BB_CAPTURE_EXPLORE_COMPANIONS === "1" ? [companions(context)] : []),
  {
    id: "explore",
    packageDir: "bb-studio-pages/src/explore",
    privateSidebar: true,
    // The staged BB seeds a thread that reads Orbit's retry helper with
    // Explore on; its reply must end with "Along the way" rows.
    setup: async (client) => {
      const exploreThreadId = process.env.BB_CAPTURE_EXPLORE_THREAD_ID ?? threadId;
      await client.navigate(`/projects/${projectId}/threads/${exploreThreadId}`);
      await client.waitForSelector('section[aria-label="Along the way"]');
      await client.waitForText("Turn off in settings");
      await client.evaluate(`(() => {
        const section = document.querySelector('section[aria-label="Along the way"]');
        const rows = section.querySelectorAll("li");
        if (rows.length < 1) throw new Error("Along the way has no rows");
        if (!section.innerText.includes("Explore")) throw new Error("The rows have no Explore action: " + section.innerText);
        if (document.body.innerText.includes("::explore{")) throw new Error("The raw ::explore directive is still visible");
        section.scrollIntoView({ block: "center" });
        return true;
      })()`);
    },
    // End the frame below the rows, above the composer.
    clip: (client) =>
      client.evaluate(`(() => {
        const section = document.querySelector('section[aria-label="Along the way"]');
        const bottom = section.getBoundingClientRect().bottom + 24;
        return { x: 0, y: 0, width: window.innerWidth, height: Math.round(bottom) };
      })()`),
  },
];
};
