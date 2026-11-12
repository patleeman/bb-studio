import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { PresenceEntryView } from "../contract";
import { PRESENCE_STATES, STATE_NAMES } from "../forms";
import { DEFAULT_PALETTE } from "../palette";
import type { Presence } from "../schema";
import { PresenceSection } from "../ui/PresenceSection";
import { PresenceView } from "../ui/PresenceView";
import { failureKey, presenceFailure } from "../ui/state";

declare const CUSTOM_CODE: string;
declare const START_FORM: string;

const entries: PresenceEntryView[] = [
  { id: "origami-crane", name: "Origami crane", description: "A paper crane that slowly unfolds and folds its wings.", source: "stored", creator: { name: "Chief of Staff", botId: "cos" }, usedBy: [], code: CUSTOM_CODE, updatedAt: 1 },
  { id: "stuck", name: "Stuck", description: "", source: "stored", creator: null, usedBy: [], code: "function draw() { for (;;) {} }", updatedAt: 1 },
];

function Harness() {
  const [value, setValue] = useState<Presence>({ form: START_FORM, color: { source: "theme" }, motion: 1 });
  const crane = entries[0]!;
  return (
    <div className="flex flex-col gap-4 p-6 text-foreground" style={{ width: 900 }}>
      <div data-testid="edit-space-pane" className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5 shadow-lg">
        <h2 className="text-sm font-semibold">Edit space</h2>
        <span className="text-xs font-medium text-foreground">Presence</span>
        <PresenceSection bot={{ id: "cos", name: "Chief of Staff", primary: true }} value={value} onChange={setValue} entries={entries} onAsk={async () => {}} />
      </div>
      <div data-testid="crane-states" className="flex items-end gap-6 rounded-xl border border-border bg-background p-5">
        {PRESENCE_STATES.map((state) => (
          <div key={state} className="flex flex-col items-center gap-2 text-xs">
            <div className="flex items-center gap-3">
              {[110, 36, 24].map((size) => <PresenceView key={size} form={crane.id} custom={crane} palette={DEFAULT_PALETTE} light={false} state={state} workers={2} motion={1} size={size} />)}
            </div>
            <span>{`Origami crane · ${STATE_NAMES[state]}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const host = document.createElement("div");
document.body.append(host);
createRoot(host).render(<Harness />);
setTimeout(() => {
  const frames = document.querySelectorAll("iframe").length;
  const tiles = [...document.querySelectorAll<HTMLElement>('[data-testid="presence-tile"]')].map((tile) => ({ form: tile.dataset.form, canvas: !!tile.querySelector("canvas"), frame: !!tile.querySelector("iframe") }));
  const box = host.getBoundingClientRect();
  (window as unknown as { __done: unknown }).__done = { width: Math.ceil(box.width), height: Math.ceil(box.height), frames, tiles, failures: entries.map((entry) => [entry.id, presenceFailure(failureKey(entry))]) };
}, 3500);
