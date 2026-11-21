// Where the Strands page lives: `bot/<botId>/strands`, and the older Tasks
// address `bot/<botId>/loops`, which opens the same page. Kept apart from
// its UI so the sidebar can read them cheaply.
export const strandsPath = (botId: string) => `/plugins/studio/studio/bot/${encodeURIComponent(botId)}/strands`;
export const isStrandsPath = (pathname: string) => /^\/plugins\/studio\/studio\/bot\/[^/]+\/(?:strands|loops)\/?$/.test(pathname);
