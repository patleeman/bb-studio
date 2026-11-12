// The page's CSS for an organic look: its tokens on BB's current theme, the
// kit's classes, and each look's tile chrome and ground. Scoped to
// .cv-scope, which the canvas page carries.
import { COLOR_TOKENS, type OrganicLook } from "../looks";
import type { BbTheme } from "../theme";
import { kitCss, tokenCss } from "./kit-css";

const S = ".cv-scope";

const COMMON = `
.canvas-page${S}{background:var(--cv-paper);color:var(--cv-ink)}
${S} .canvas-chat{background:var(--cv-paper)}
${S} .canvas-scroll{background-color:var(--cv-paper)}
${S} .cvt{position:absolute;will-change:transform;font-family:var(--cv-font-text);color:var(--cv-ink)}
${S} .cvt-rot{transform-origin:50% 35%}
${S} .cvt-fit{position:absolute;left:0;top:0;width:100%;height:0;transform-origin:0 0;transition:transform .56s cubic-bezier(.2,.8,.2,1)}
@media (prefers-reduced-motion: reduce){${S} .cvt-fit{transition:none}}
${S} .cvt-card{position:relative;color:var(--cv-ink)}
${S} .cvt-head{font-family:var(--cv-font-label);font-size:var(--cv-t-xs);font-weight:700;letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-ink);margin-bottom:var(--cv-s-3);display:flex;align-items:center;gap:8px}
${S} .cvt-head span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .cvi-chart svg{display:block}
${S} .cvi-stat-spark{margin-top:8px;line-height:0}
${S} .cvi-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--cv-s-3)}
${S} .cvi-list li{display:grid;grid-template-columns:1.6em 1fr;gap:var(--cv-s-2);align-items:baseline}
${S} .cvi-list-n{font-family:var(--cv-font-num);font-size:var(--cv-t-lg);color:var(--cv-accent);font-weight:600;font-variant-numeric:tabular-nums}
${S} .cvi-list-title{font-weight:600;color:var(--cv-ink);line-height:1.3}
${S} .cvi-ticker{display:flex;flex-wrap:wrap;gap:var(--cv-s-2) var(--cv-s-5);align-items:baseline}
${S} .cvi-ticker-item{display:inline-flex;align-items:baseline;gap:8px}
${S} .cv-body p{margin:0 0 var(--cv-s-3)}
${S} .cv-body p:last-child{margin-bottom:0}
${S} .cvt[data-kind=caption][data-scale=hero] .cv-body{font-size:var(--cv-t-2xl);line-height:1.25}
${S} .cvt[data-kind=caption][data-scale=large] .cv-body{font-size:var(--cv-t-xl);line-height:1.35}
${S} .cvt[data-kind=caption][data-scale=medium] .cv-body{font-size:var(--cv-t-lg);line-height:1.42}
`;

// No boxes: text and charts sit on the paper. Hierarchy comes from scale,
// type and whitespace; a rule or a tick marks a piece only where it helps.
const LOOKS: Record<OrganicLook, string> = {
  editorial: `
${S}[data-cv-look=editorial] .canvas-scroll{background-image:none}
${S} .cvt-card{background:transparent}
${S} .cvt-head{color:var(--cv-muted);font-weight:600}
${S} .cvt-head::before{content:"";width:14px;height:2px;background:var(--cv-accent);flex:none}
${S} .cvt[data-scale=hero] .cvt-head{color:var(--cv-ink)}
${S} .cvt[data-kind=caption] .cv-body{font-size:var(--cv-t-lg)}
${S} .cvt[data-scale=hero][data-kind=caption] .cv-body{font-size:var(--cv-t-xl);line-height:1.42}
${S} .cvt[data-kind=table] .cvt-card{border-top:2px solid var(--cv-rule-strong);padding-top:10px}
`,
  field: `
${S} .cvt-card{background:transparent}
${S} .cvt[data-kind=caption] .cv-body{font-family:var(--cv-font-hand);font-size:var(--cv-t-lg);font-weight:600;line-height:1.35}
${S} .cvt-head{font-family:var(--cv-font-hand);font-size:var(--cv-t-lg);letter-spacing:0;text-transform:none;color:var(--cv-accent);margin-bottom:6px}
${S} .cvt[data-scale=hero] .cvt-head{font-family:var(--cv-font-display);font-size:var(--cv-t-2xl);color:var(--cv-ink)}
${S} .cvi-underline{background:linear-gradient(100deg,transparent 1%,var(--cv-highlight) 2%,var(--cv-highlight) 97%,transparent 99%) 0 88%/100% 0.32em no-repeat;padding:0 0.08em}
${S} .cv-stat-label{font-family:var(--cv-font-hand)}
`,
  instrument: `
${S}[data-cv-look=instrument] .canvas-scroll{background-image:radial-gradient(color-mix(in oklab,var(--cv-rule) 90%,transparent) 1px,transparent 1.2px);background-size:24px 24px;background-position:-1px -1px}
${S} .cvt-card{background:transparent}
${S} .cvt-head{margin:0 0 6px;padding:0;font-size:10px;font-weight:500;color:var(--cv-muted)}
${S} .cvt[data-scale=hero] .cvt-head{font-size:11px;color:var(--cv-accent)}
${S} .cvt-tag{color:var(--cv-accent);font-weight:700;flex:none}
${S} .cvt-head .cvt-kind{margin-left:auto;opacity:.7;flex:none}
${S} .cvt[data-kind=table] .cvt-card,${S} .cvt[data-kind=multiples] .cvt-card{border-top:1px solid var(--cv-rule)}
`,
};

const ACCENTS = `
/* Accents: a quote's pull or bar form looks the same in every style. */
${S} .cvt[data-accent] .cvt-card{border:0;box-shadow:none;border-radius:0;padding:0;background:transparent}
${S} .cvt[data-accent=pull] .cvt-card{background:transparent}
${S} .cvt[data-kind=quote][data-accent=pull] .cv-quote{font-family:var(--cv-font-margin);font-style:italic;font-size:var(--cv-t-2xl);line-height:1.12;font-weight:500;color:var(--cv-ink)}
${S} .cvt[data-kind=quote][data-accent=pull] .cv-quote::before{content:"“";display:block;font-size:2.2em;line-height:0.6;color:var(--cv-accent);margin-bottom:0.08em;font-style:normal}
${S} .cvt[data-accent=bar] .cvt-card{border-left:2px solid var(--cv-accent);background:transparent}
${S} .cvt[data-kind=quote][data-accent=bar] .cv-quote{font-family:var(--cv-font-text);font-style:normal;font-size:var(--cv-t-md);font-weight:500}
${S} .cvt[data-kind=quote][data-accent=bar] .cv-quote::before{content:none}
`;

/**
 * A style switch, or a change of BB's theme, cross-fades the palette: the color tokens are registered
 * (so they interpolate) and transition on the page. Fonts and sizes switch
 * at once, while the cards glide to their new places and fade back in.
 */
const SWITCH = COLOR_TOKENS.map((name) => `@property --cv-${name}{syntax:"<color>";inherits:true;initial-value:transparent}`).join("")
  + `${S}{transition:${COLOR_TOKENS.map((name) => `--cv-${name} .7s ease`).join(",")}}`
  + `@media (prefers-reduced-motion: reduce){${S}{transition:none}}`;

/** Everything an organic look needs on the page, on BB's theme, scoped to .cv-scope[data-cv-look=…]. */
export function lookCss(look: OrganicLook, theme: BbTheme): string {
  return tokenCss(look, theme, `${S}[data-cv-look=${look}]`) + kitCss(look, S) + COMMON + LOOKS[look] + ACCENTS + SWITCH;
}
