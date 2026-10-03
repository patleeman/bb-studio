import type { Room } from "./contract";

export function botCreationPrompt(room?: Pick<Room, "id" | "name">, spaceId?: string): string {
  return [
    "Help me create a persistent bot in BB Studio Teams through this conversation.",
    "Use the Bots skill and `bb studio bot-teams` CLI to create it. If I have not described what the bot should do, ask me that one question first. Keep setup conversational: no forms or questionnaires. Choose a fitting name, avatar, role, mission, and available provider/model from my description and BB defaults. Ask only when a missing decision materially changes the bot’s purpose or access.",
    "Create the bot once its purpose is clear. Write its mission and configure it yourself; do not give me commands to run. Keep the mission schedule interval at 0 unless I ask for a schedule. Use the default permissions unless I request otherwise.",
    ...(spaceId
      ? [
          `After creation, add the bot and this thread to my Studio space (space ID: ${JSON.stringify(spaceId)}) with the studio_space_items tool: add /plugins/studio/bots/BOT_ID and thisThread "add".`,
        ]
      : []),
    "Verify the saved bot, then reply briefly with its handle and a link to its profile at /plugins/studio/bots/BOT_ID/profile.",
  ].join("\n\n");
}
