export const WELCOME_BOT_NAME = "Assistant";
export const WELCOME_TITLE = "Welcome";
export const ACCOUNTS_LINK = "bb://accounts";
export const EDIT_SPACE_LINK = "bb://edit-space";

export type WelcomePart = string | { text: string; link: string };

export interface WelcomeMessage {
  intro: string;
  heading: string;
  tries: readonly (readonly WelcomePart[])[];
}

export const WELCOME_MESSAGE: WelcomeMessage = {
  intro: "Welcome to BB Studio. Here you work with your Bots: you ask, the Bot does the work, and you check it and decide together.",
  heading: "Things to try:",
  tries: [
    ["Ask me something in the box below."],
    ["Open ", { text: "Edit space", link: EDIT_SPACE_LINK }, " to pick a theme and presence."],
    ["Sign in to Claude or Codex in ", { text: "Accounts", link: ACCOUNTS_LINK }, "."],
  ],
};

export function welcomeLinks(message: WelcomeMessage = WELCOME_MESSAGE): string[] {
  return message.tries.flatMap((parts) => parts.flatMap((part) => (typeof part === "string" ? [] : [part.link])));
}

export function welcomeText(message: WelcomeMessage = WELCOME_MESSAGE): string {
  const line = (parts: readonly WelcomePart[]) => parts.map((part) => (typeof part === "string" ? part : `[${part.text}](${part.link})`)).join("");
  return [message.intro, "", message.heading, ...message.tries.map((parts) => `- ${line(parts)}`)].join("\n");
}
