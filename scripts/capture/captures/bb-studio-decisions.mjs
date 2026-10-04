import { createServer } from "node:http";

/**
 * A local stand-in for TypeSafe's System One API: it answers every noul
 * question "no" and every choice with its first option, so the live Test
 * button has a provider to reach.
 */
async function startJevStandIn() {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const { questions } = JSON.parse(body);
      const answers = Object.fromEntries(
        Object.entries(questions).map(([id, question]) => {
          if (question.type === "noul") return [id, { type: "noul", noul: 0 }];
          const options = Object.keys(question.criteria);
          const probabilities = Object.fromEntries(options.map((option, index) => [option, index ? 0 : 1]));
          return [id, { type: "choice", choice: options[0], confidence: 1, probabilities }];
        }),
      );
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ answers }));
    });
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  return { endpoint: `http://127.0.0.1:${server.address().port}/v1/systemone`, close: () => new Promise((resolvePromise) => server.close(resolvePromise)) };
}

export default ({ bbCli }) => [
  {
    id: "decisions",
    packageDir: "bb-studio-decisions",
    setup: async (client) => {
      const jev = await startJevStandIn();
      const settings = { jevProvider: "custom", customJevEndpoint: jev.endpoint, customJevModel: "jev-local" };
      const cleanup = async () => {
        for (const key of Object.keys(settings)) await bbCli(["plugin", "config", "smart-decisions", "unset", key]).catch(() => {});
        await jev.close();
      };
      try {
        for (const [key, value] of Object.entries(settings)) await bbCli(["plugin", "config", "smart-decisions", "set", key, value]);
        await client.navigate("/settings/plugins/smart-decisions");
        await client.waitForText("Studio Decisions");
        await client.waitForText("Jev connection");
        await client.waitForText("jev-local");
        await client.waitForText("Fallback model");
        await client.clickButtonText("Test");
        await client.waitForText("Jev answered through");
        await client.evaluate(`(() => {
          const routes = document.querySelector('[aria-label="Jev providers in order"]')?.innerText ?? '';
          if (!routes.includes('jev-local')) throw new Error('Jev connection must list the custom endpoint: ' + routes);
          // Scroll the settings page to its end: the test result and the fallback model.
          for (const el of document.querySelectorAll('*'))
            if (el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
        })()`);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  }
];
