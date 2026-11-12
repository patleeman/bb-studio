import { createRoot } from "react-dom/client";
import { EVENT_HORIZON } from "../../theme/builtin/event-horizon";
import { GITHUB_LIGHT } from "../../theme/builtin/classic";
import { BotFace } from "../ui/BotFace";

declare const ROWS_LIGHT: boolean;
declare const CRANE_CODE: string;

const theme = ROWS_LIGHT ? GITHUB_LIGHT : EVENT_HORIZON;
const colors = (ROWS_LIGHT ? GITHUB_LIGHT.variants.light : EVENT_HORIZON.variants.dark)!;
const appearance = { themeId: theme.id, intensity: 0.7, glass: 0.6, motion: 0.4, effects: {} };
const bots = [
  { id: "bot_main", name: "Chief of Staff", primary: true, needsYou: false, activity: { turn: false, workers: 2 }, appearance, presence: { form: "origami-crane", color: { source: "theme" }, motion: 1 } },
  { id: "bot_scout", name: "Scout", primary: false, needsYou: true, activity: { turn: false, workers: 0 }, appearance, presence: { form: "tesseract", color: { source: "theme" }, motion: 1 } },
  { id: "bot_lamp", name: "Lamp", primary: false, needsYou: false, activity: { turn: true, workers: 0 }, appearance, presence: { form: "orb", color: { source: "theme" }, motion: 1 } },
];
(globalThis as unknown as { __LIVE__: unknown }).__LIVE__ = {
  bot_spaces: { bots, currentBotId: "bot_main" },
  presences_list: { presences: [{ id: "origami-crane", name: "Origami crane", description: "", source: "stored", creator: null, usedBy: [], code: CRANE_CODE, updatedAt: 1 }] },
};
document.documentElement.classList.toggle("dark", !ROWS_LIGHT);
document.documentElement.style.cssText = `--ink:${colors.ink};--canvas:${colors.canvas};background:${colors.sidebar};color:${colors.ink};font:13px -apple-system,system-ui,sans-serif`;

function Rows() {
  return (
    <nav aria-label="Bots" style={{ display: "flex", flexDirection: "column", gap: 2, padding: 12, width: 260 }}>
      <span style={{ fontWeight: 600, padding: "0 8px 6px" }}>{theme.name}</span>
      {bots.map((bot, index) => (
        <div key={bot.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6, background: index ? undefined : `color-mix(in oklab, ${colors.accent} 14%, transparent)` }}>
          <BotFace botId={bot.id} size={index ? 22 : 28} />
          <span style={{ fontWeight: index ? 400 : 500 }}>{bot.name}</span>
        </div>
      ))}
    </nav>
  );
}

const host = document.createElement("div");
host.style.display = "inline-block";
document.body.append(host);
createRoot(host).render(<Rows />);
setTimeout(() => {
  const box = host.getBoundingClientRect();
  (window as unknown as { __done: unknown }).__done = { width: Math.ceil(box.width), height: Math.ceil(box.height), faces: [...document.querySelectorAll<HTMLElement>("[data-testid=bot-presence]")].map((each) => `${each.dataset.form}:${each.dataset.state}:${each.style.width}`) };
}, 3000);
