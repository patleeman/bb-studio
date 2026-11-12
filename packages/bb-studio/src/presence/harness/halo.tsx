import { createRoot } from "react-dom/client";
import { EVENT_HORIZON } from "../../theme/builtin/event-horizon";
import { GITHUB_LIGHT } from "../../theme/builtin/classic";
import type { PresenceEntryView } from "../contract";
import { BUILTIN_FORMS, FORM_NAMES, PRESENCE_STATES, STATE_NAMES } from "../forms";
import { presenceLook } from "../look";
import { PresenceView } from "../ui/PresenceView";

declare const HALO_LIGHT: boolean;
declare const HALO_OFF: boolean;
declare const CRANE_CODE: string;
declare const LAVA_CODE: string;

const theme = HALO_LIGHT ? GITHUB_LIGHT : EVENT_HORIZON;
const colors = HALO_LIGHT ? GITHUB_LIGHT.variants.light! : EVENT_HORIZON.variants.dark!;
const look = presenceLook({ color: { source: "theme" } }, theme, HALO_LIGHT ? "light" : "dark");
const entry = (id: string, name: string, code: string): PresenceEntryView => ({ id, name, description: "", source: "stored", creator: null, usedBy: [], code, updatedAt: 1 });
const customs = [entry("origami-crane", "Origami crane", CRANE_CODE), entry("lava-lamp", "Lava lamp", LAVA_CODE)];
const rows: { id: string; name: string; custom: PresenceEntryView | null }[] = [...customs.map((each) => ({ id: each.id, name: each.name, custom: each })), ...BUILTIN_FORMS.map((form) => ({ id: form, name: FORM_NAMES[form], custom: null }))];

document.documentElement.classList.toggle("dark", !HALO_LIGHT);
document.documentElement.style.cssText = `--ink:${colors.ink};--canvas:${colors.canvas};background:${colors.canvas};color:${colors.ink};font:12px -apple-system,system-ui,sans-serif`;
if (HALO_OFF) { const style = document.createElement("style"); style.textContent = "[data-presence-canvas],[data-presence-custom]{filter:none!important}"; document.head.append(style); }

function Sheet() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px repeat(4, auto)", gap: "10px 26px", padding: 18, alignItems: "center", width: "max-content" }}>
      <span style={{ fontWeight: 600 }}>{`${theme.name}${HALO_OFF ? " · no halo" : ""}`}</span>
      {PRESENCE_STATES.map((state) => <span key={state} style={{ fontWeight: 600 }}>{STATE_NAMES[state]}</span>)}
      {rows.map((row) => [
        <span key={`${row.id}-name`}>{row.name}</span>,
        ...PRESENCE_STATES.map((state) => (
          <span key={`${row.id}-${state}`} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {[36, 24].map((size) => <PresenceView key={size} form={row.id} custom={row.custom} palette={look.palette} light={look.light} state={state} workers={2} motion={1} size={size} still />)}
          </span>
        )),
      ])}
    </div>
  );
}

const host = document.createElement("div");
host.style.display = "inline-block";
document.body.append(host);
createRoot(host).render(<Sheet />);
setTimeout(() => {
  const box = host.getBoundingClientRect();
  (window as unknown as { __done: unknown }).__done = { width: Math.ceil(box.width), height: Math.ceil(box.height), stills: document.querySelectorAll("[data-presence-still]").length };
}, 4000);
