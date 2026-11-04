// The page's CSS for an organic look: its tokens on the page (light, and
// dark under data-cv-mode="dark"), the kit's classes, and each look's tile
// chrome and ground. Scoped to .cv-scope, which the canvas page carries.
import type { OrganicLook } from "../looks";
import { kitCss, tokenCss } from "./kit-css";

const S = ".cv-scope";

const COMMON = `
.canvas-page${S}{background:var(--cv-paper);color:var(--cv-ink)}
${S} .canvas-chat{background:var(--cv-paper)}
${S} .canvas-scroll{background-color:var(--cv-paper)}
${S} .cvt{position:absolute;will-change:transform;font-family:var(--cv-font-text);color:var(--cv-ink)}
${S} .cvt-rot{transform-origin:50% 35%}
${S} .cvt-card{position:relative;color:var(--cv-ink)}
${S} .cvt-head{font-family:var(--cv-font-label);font-size:var(--cv-t-xs);font-weight:700;letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-ink);margin-bottom:var(--cv-s-3);display:flex;align-items:center;gap:8px}
${S} .cvt-head span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .cvt-links{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
${S} .cvt-link{fill:none;transition:d .56s cubic-bezier(.2,.8,.2,1)}
${S} .cvt-link-new{stroke-dasharray:1;stroke-dashoffset:1;animation:cvt-draw .8s .3s cubic-bezier(.4,0,.2,1) forwards}
${S} .cvt-link-label{font-family:var(--cv-font-label);font-size:10.5px;fill:var(--cv-muted)}
@keyframes cvt-draw{to{stroke-dashoffset:0}}
@media (prefers-reduced-motion: reduce){${S} .cvt-link-new{animation:none;stroke-dasharray:none;stroke-dashoffset:0}${S} .cvt-link{transition:none}}
${S} .cvi-chart svg{display:block}
${S} .cvi-stat-spark{margin-top:8px;line-height:0}
${S} .cvi-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--cv-s-3)}
${S} .cvi-list li{display:grid;grid-template-columns:1.6em 1fr;gap:var(--cv-s-2);align-items:baseline}
${S} .cvi-list-n{font-family:var(--cv-font-num);font-size:var(--cv-t-lg);color:var(--cv-accent);font-weight:600;font-variant-numeric:tabular-nums}
${S} .cvi-list-title{font-weight:600;color:var(--cv-ink);line-height:1.3}
${S} .cvi-ticker{display:flex;flex-wrap:wrap;gap:var(--cv-s-2) var(--cv-s-5);align-items:baseline}
${S} .cvi-ticker-item{display:inline-flex;align-items:baseline;gap:8px}
${S} .cvi-note-text p{margin:0}
${S} .cvi-note-text p + p{margin-top:4px}
${S} .cv-body p{margin:0 0 var(--cv-s-3)}
${S} .cv-body p:last-child{margin-bottom:0}
`;

const LOOKS: Record<OrganicLook, string> = {
  editorial: `
${S}[data-cv-look=editorial] .canvas-scroll{background-image:none}
${S} .cvt-card{border-top:1px solid var(--cv-rule-strong);padding-top:12px;background:var(--cv-paper)}
${S} .cvt[data-focus] .cvt-card{border-top-width:4px;padding-top:16px}
${S} .cvt[data-kind=headline] .cvt-card,${S} .cvt[data-kind=quote] .cvt-card,${S} .cvt[data-kind=note] .cvt-card{border-top:0;padding-top:0}
${S} .cvt[data-kind=headline][data-focus] .cvt-card{border-bottom:3px double var(--cv-rule-strong);padding-bottom:18px}
${S} .cvt[data-kind=quote] .cvt-card{background:var(--cv-paper);padding:6px 10px 6px 0}
${S} .cvt[data-kind=note] .cvt-card{background:var(--cv-paper);border-left:2px solid var(--cv-accent);padding:4px 0 4px 12px}
${S} .cvt[data-kind=note] .cv-note{font-family:var(--cv-font-text);font-style:italic;font-size:var(--cv-t-sm);color:var(--cv-ink-2);line-height:1.4}
${S} .cvt-head{color:var(--cv-ink)}
${S} .cvt-head::before{content:"";width:7px;height:7px;background:var(--cv-accent);flex:none}
${S} .cvt[data-kind=caption] .cv-body{font-size:var(--cv-t-lg)}
`,
  field: `
${S} .cvt-card{background:var(--cv-surface);border-radius:var(--cv-radius);box-shadow:var(--cv-shadow)}
${S} .cvt[data-kind=headline] .cvt-card{background:transparent;box-shadow:none}
${S} .cvt[data-focus]:not([data-kind=headline]) .cvt-card::after{content:"";position:absolute;top:-8px;left:50%;width:15px;height:15px;margin-left:-7px;border-radius:99px;background:radial-gradient(circle at 35% 35%,#ff8a80,var(--cv-red) 60%);box-shadow:0 2px 3px rgb(0 0 0/.35)}
${S} .cvt[data-kind=note] .cvt-card{background:var(--cv-sticky);color:var(--cv-sticky-ink);border-radius:2px;box-shadow:0 1px 0 rgb(0 0 0/.06),0 12px 20px -12px rgb(60 50 0/.5)}
${S} .cvt[data-kind=note] .cvt-card::before{content:"";position:absolute;top:-9px;left:50%;width:58px;height:18px;transform:translateX(-50%) rotate(-3deg);background:color-mix(in oklab,var(--cv-paper) 60%,transparent);border:1px solid color-mix(in oklab,var(--cv-ink) 8%,transparent)}
${S} .cvt[data-kind=note] .cv-note{color:var(--cv-sticky-ink);font-size:var(--cv-t-lg);font-weight:600}
${S} .cvt[data-kind=quote] .cvt-card{background:var(--cv-sticky-2);color:var(--cv-sticky-ink);border-radius:2px}
${S} .cvt[data-kind=quote] .cv-quote{color:var(--cv-sticky-ink)}
${S} .cvt[data-kind=quote] .cv-quote cite{color:color-mix(in oklab,var(--cv-sticky-ink) 70%,transparent)}
${S} .cvt[data-kind=caption] .cvt-card{background:var(--cv-sticky-3);color:var(--cv-sticky-ink);border-radius:2px}
${S} .cvt[data-kind=caption] .cv-body{color:var(--cv-sticky-ink);font-family:var(--cv-font-hand);font-size:var(--cv-t-lg);font-weight:600;line-height:1.35}
${S} .cvt-head{font-family:var(--cv-font-hand);font-size:var(--cv-t-lg);letter-spacing:0;text-transform:none;color:var(--cv-accent);margin-bottom:6px}
${S} .cvi-underline{background:linear-gradient(100deg,transparent 1%,var(--cv-highlight) 2%,var(--cv-highlight) 97%,transparent 99%) 0 88%/100% 0.32em no-repeat;padding:0 0.08em}
${S} .cv-stat-label{font-family:var(--cv-font-hand)}
`,
  instrument: `
${S}[data-cv-look=instrument] .canvas-scroll{background-image:linear-gradient(color-mix(in oklab,var(--cv-rule) 55%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in oklab,var(--cv-rule) 55%,transparent) 1px,transparent 1px);background-size:24px 24px;background-position:-1px -1px}
${S} .cvt-card{background:var(--cv-surface);border:1px solid var(--cv-rule);border-radius:var(--cv-radius)}
${S} .cvt[data-focus] .cvt-card{border-color:color-mix(in oklab,var(--cv-accent) 55%,var(--cv-rule));box-shadow:inset 0 2px 0 var(--cv-accent)}
${S} .cvt[data-kind=headline] .cvt-card{background:transparent;border:0;box-shadow:none}
${S} .cvt-head{height:26px;margin:0;padding:0 10px;border-bottom:1px solid var(--cv-rule);font-size:10px;font-weight:500;color:var(--cv-muted)}
${S} .cvt-tag{color:var(--cv-accent);font-weight:700;flex:none}
${S} .cvt-head .cvt-kind{margin-left:auto;opacity:.7;flex:none}
${S} .cvt[data-kind=note] .cvt-card{border:1px dashed var(--cv-accent);background:color-mix(in oklab,var(--cv-accent) 8%,var(--cv-surface))}
${S} .cvt[data-kind=note] .cv-note{font-family:var(--cv-font-label);font-size:var(--cv-t-xs);line-height:1.45;color:var(--cv-ink)}
${S} .cvt[data-kind=quote] .cvt-card{border-left:2px solid var(--cv-accent)}
${S} .cvt[data-kind=quote] .cv-quote{font-family:var(--cv-font-text);font-size:var(--cv-t-md);font-weight:500}
`,
};

/** Everything an organic look needs on the page, scoped to .cv-scope[data-cv-look=…]. */
export function lookCss(look: OrganicLook): string {
  const scope = `${S}[data-cv-look=${look}]`;
  return tokenCss(look, scope, `${scope}[data-cv-mode=dark]`) + kitCss(look, S) + COMMON + LOOKS[look];
}
