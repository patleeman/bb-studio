// The kit's CSS: shared class names (cv-kicker, cv-h1, cv-num, cv-hbars,
// cv-timeline, …) styled only with --cv-* tokens, then a layer per look.
// The page scopes it under .cv-scope; a custom frame gets it unscoped.
import { tokenDeclarations, type OrganicLook } from "../looks";
import type { BbTheme } from "../theme";

const BASE = (S: string) => `
${S} .cv-root{font-family:var(--cv-font-text);font-size:var(--cv-t-md);line-height:1.45;color:var(--cv-ink)}
${S} .cv-kicker{font-family:var(--cv-font-label);font-size:var(--cv-t-xs);font-weight:600;letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-accent);line-height:1.2}
${S} .cv-label{font-family:var(--cv-font-label);font-size:var(--cv-t-xs);font-weight:500;letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-muted);line-height:1.25}
${S} .cv-h1{font-family:var(--cv-font-display);font-size:var(--cv-t-3xl);font-weight:var(--cv-display-weight);line-height:1.02;letter-spacing:-0.012em;text-wrap:balance;margin:0;color:var(--cv-ink)}
${S} .cv-h2{font-family:var(--cv-font-display);font-size:var(--cv-t-2xl);font-weight:var(--cv-display-weight);line-height:1.06;letter-spacing:-0.01em;text-wrap:balance;margin:0;color:var(--cv-ink)}
${S} .cv-h3{font-family:var(--cv-font-display);font-size:var(--cv-t-xl);font-weight:var(--cv-display-weight);line-height:1.12;text-wrap:balance;margin:0;color:var(--cv-ink)}
${S} .cv-dek{font-family:var(--cv-font-text);font-size:var(--cv-t-lg);line-height:1.38;color:var(--cv-ink-2);margin:0;text-wrap:pretty}
${S} .cv-body{font-family:var(--cv-font-text);font-size:var(--cv-t-md);line-height:1.55;color:var(--cv-ink-2);text-wrap:pretty}
${S} .cv-body p{margin:0 0 var(--cv-s-3)}
${S} .cv-body p:last-child{margin-bottom:0}
${S} .cv-small{font-size:var(--cv-t-sm);color:var(--cv-muted);line-height:1.4}
${S} .cv-num{font-family:var(--cv-font-num);font-size:var(--cv-t-3xl);font-weight:var(--cv-display-weight);line-height:0.95;font-variant-numeric:tabular-nums lining-nums;letter-spacing:-0.02em;color:var(--cv-ink)}
${S} .cv-num-sm{font-family:var(--cv-font-num);font-size:var(--cv-t-xl);font-weight:var(--cv-display-weight);line-height:1;font-variant-numeric:tabular-nums lining-nums;color:var(--cv-ink)}
${S} .cv-unit{font-family:var(--cv-font-label);font-size:0.38em;color:var(--cv-muted);letter-spacing:0.02em;margin-left:0.12em;font-weight:500}
${S} .cv-delta{display:inline-flex;align-items:center;gap:0.2em;font-family:var(--cv-font-label);font-size:var(--cv-t-xs);font-weight:600;padding:0.1em 0.45em;border-radius:var(--cv-radius-sm);background:color-mix(in oklab,var(--cv-muted) 14%,transparent);color:var(--cv-ink-2);white-space:nowrap;vertical-align:0.1em}
${S} .cv-up{color:var(--cv-good);background:color-mix(in oklab,var(--cv-good) 14%,transparent)}
${S} .cv-down{color:var(--cv-bad);background:color-mix(in oklab,var(--cv-bad) 14%,transparent)}
${S} .cv-chip,${S} .cv-tag{display:inline-flex;align-items:center;gap:0.3em;font-family:var(--cv-font-label);font-size:var(--cv-t-xs);font-weight:600;letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);padding:0.15em 0.5em;border-radius:var(--cv-radius-sm);background:var(--cv-tag-bg,color-mix(in oklab,var(--cv-accent) 14%,transparent));color:var(--cv-tag-ink,var(--cv-accent))}
${S} .cv-rule{border:0;border-top:1px solid var(--cv-rule);margin:var(--cv-s-3) 0}
${S} .cv-hl{background:linear-gradient(transparent 55%,var(--cv-highlight) 55%);padding:0 0.1em}
${S} .cv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(var(--cv-col,140px),1fr));gap:var(--cv-s-4)}
${S} .cv-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--cv-s-3)}
${S} .cv-stack{display:flex;flex-direction:column;gap:var(--cv-s-2)}
${S} .cv-float-right{float:right;width:var(--cv-float-w,42%);margin:0.2em 0 var(--cv-s-2) var(--cv-s-4)}
${S} .cv-float-left{float:left;width:var(--cv-float-w,42%);margin:0.2em var(--cv-s-4) var(--cv-s-2) 0}
${S} .cv-clear{clear:both}
${S} .cv-figure{margin:0}
${S} .cv-caption{font-family:var(--cv-font-label);font-size:var(--cv-t-xs);color:var(--cv-muted);margin-top:var(--cv-s-1);line-height:1.35}
${S} .cv-quote{font-family:var(--cv-font-display);font-size:var(--cv-t-xl);line-height:1.2;color:var(--cv-ink);margin:0;text-wrap:balance}
${S} .cv-quote cite,${S} .cv-cite{display:block;font-style:normal;font-family:var(--cv-font-label);font-size:var(--cv-t-xs);letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-muted);margin-top:var(--cv-s-2)}
${S} .cv-legend{display:flex;flex-wrap:wrap;gap:var(--cv-s-1) var(--cv-s-3);font-family:var(--cv-font-label);font-size:var(--cv-t-xs);color:var(--cv-ink-2)}
${S} .cv-legend b{font-weight:600;color:var(--cv-ink)}
${S} .cv-swatch{display:inline-block;width:0.7em;height:0.7em;border-radius:2px;margin-right:0.35em;vertical-align:-0.02em}
${S} .cv-spark{display:inline-block;vertical-align:-0.22em;overflow:visible}
${S} .cv-chart{display:block;max-width:100%;overflow:visible}
${S} .cv-grid-line{stroke:var(--cv-rule);stroke-width:1;stroke-dasharray:2 3}
${S} .cv-zero-line{stroke:var(--cv-ink-2);stroke-width:1}
${S} .cv-axis{fill:var(--cv-muted);font-family:var(--cv-font-label);font-size:10.5px}
${S} .cv-value{fill:var(--cv-ink-2);font-family:var(--cv-font-label);font-size:10.5px;font-weight:600}
${S} .cv-end-label{font-family:var(--cv-font-label);font-size:11.5px;font-weight:700}
${S} .cv-mark-line{stroke:var(--cv-muted);stroke-width:1;stroke-dasharray:3 3}
${S} .cv-mark-text{fill:var(--cv-ink-2);font-family:var(--cv-font-hand);font-size:11px}
${S} .cv-donut-center{fill:var(--cv-ink);font-family:var(--cv-font-num);font-size:20px;font-weight:600}
${S} .cv-table{width:100%;border-collapse:collapse;font-size:var(--cv-t-sm);font-variant-numeric:tabular-nums}
${S} .cv-table th{font-family:var(--cv-font-label);font-size:var(--cv-t-xs);font-weight:600;letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-muted);text-align:left;padding:var(--cv-s-1) var(--cv-s-2);border-bottom:1px solid var(--cv-rule-strong);vertical-align:bottom}
${S} .cv-table td{padding:var(--cv-s-2);border-bottom:1px solid var(--cv-rule);color:var(--cv-ink);vertical-align:top;overflow-wrap:anywhere}
${S} .cv-table td.n,${S} .cv-table th.n{text-align:right;white-space:nowrap}
${S} .cv-hbars{display:grid;grid-template-columns:minmax(64px,max-content) 1fr auto;gap:var(--cv-s-2) var(--cv-s-3);align-items:center}
${S} .cv-hbar{display:contents}
${S} .cv-hbar-label{font-family:var(--cv-font-label);font-size:var(--cv-t-sm);color:var(--cv-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}
${S} .cv-hbar-track{position:relative;height:0.72em;min-width:40px;background:color-mix(in oklab,var(--cv-rule) 70%,transparent);border-radius:var(--cv-radius-sm);overflow:hidden}
${S} .cv-hbar-fill{position:absolute;inset:0 auto 0 0;border-radius:var(--cv-radius-sm)}
${S} .cv-hbar-value{font-family:var(--cv-font-num);font-size:var(--cv-t-sm);font-weight:600;font-variant-numeric:tabular-nums;text-align:right;color:var(--cv-ink)}
${S} .cv-hbar-note{grid-column:1/-1;margin-top:calc(var(--cv-s-2) * -1);font-size:var(--cv-t-xs);color:var(--cv-muted)}
${S} .cv-split{position:relative;padding-bottom:18px}
${S} .cv-split-labels{display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--cv-s-2);margin-bottom:var(--cv-s-2);font-family:var(--cv-font-label);font-size:var(--cv-t-sm);color:var(--cv-ink-2)}
${S} .cv-split-labels b{font-family:var(--cv-font-num);font-size:var(--cv-t-lg);color:var(--cv-ink);margin-left:0.2em}
${S} .cv-split-bar{position:relative;display:flex;height:22px;border-radius:var(--cv-radius-sm);overflow:visible;background:var(--cv-rule)}
${S} .cv-split-seg{height:100%;border-right:1.5px solid var(--cv-surface)}
${S} .cv-split-seg:first-child{border-radius:var(--cv-radius-sm) 0 0 var(--cv-radius-sm)}
${S} .cv-split-seg:last-child{border-right:0;border-radius:0 var(--cv-radius-sm) var(--cv-radius-sm) 0}
${S} .cv-split-mark{position:absolute;top:-5px;bottom:-5px;width:2px;margin-left:-1px;background:var(--cv-ink)}
${S} .cv-split-mark-label{position:absolute;bottom:0;transform:translateX(-50%);font-family:var(--cv-font-label);font-size:var(--cv-t-xs);color:var(--cv-ink-2);white-space:nowrap}
${S} .cv-donut{display:flex;align-items:center;gap:var(--cv-s-4);flex-wrap:wrap}
${S} .cv-donut .cv-legend{flex-direction:column}
${S} .cv-meter-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:var(--cv-s-1)}
${S} .cv-meter-head b{font-family:var(--cv-font-num);font-variant-numeric:tabular-nums}
${S} .cv-meter-track{position:relative;height:8px;border-radius:99px;background:color-mix(in oklab,var(--cv-rule) 80%,transparent);margin-bottom:var(--cv-s-4)}
${S} .cv-meter-fill{position:absolute;inset:0 auto 0 0;border-radius:99px}
${S} .cv-meter-mark{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--cv-ink)}
${S} .cv-meter-mark em{position:absolute;top:16px;left:50%;transform:translateX(-50%);font-style:normal;font-family:var(--cv-font-label);font-size:10px;color:var(--cv-muted);white-space:nowrap}
${S} .cv-map svg{display:block;margin:0 auto}
${S} .cv-tile{transition:opacity .2s}
${S} .cv-tile-empty{opacity:0.55}
${S} .cv-tile-text{font-family:var(--cv-font-label);font-weight:600;pointer-events:none}
${S} .cv-map-legend{display:flex;align-items:center;justify-content:center;gap:var(--cv-s-2);margin-top:var(--cv-s-2);font-family:var(--cv-font-label);font-size:var(--cv-t-xs);color:var(--cv-muted)}
${S} .cv-map-legend i{display:inline-block;width:96px;height:7px;border-radius:99px}
${S} .cv-timeline{list-style:none;margin:0;padding:0}
${S} .cv-tl-column{padding-left:20px;border-left:2px solid var(--cv-rule);margin-left:5px}
${S} .cv-tl-column .cv-tl-item{position:relative;margin-bottom:var(--cv-s-3);display:flex;flex-direction:column;gap:1px}
${S} .cv-tl-column .cv-tl-dot{position:absolute;left:-27px;top:3px}
${S} .cv-tl-row{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);border-top:2px solid var(--cv-rule);padding-top:var(--cv-s-4);gap:var(--cv-s-3)}
${S} .cv-tl-row .cv-tl-item{position:relative;display:flex;flex-direction:column;gap:1px;min-width:0}
${S} .cv-tl-row .cv-tl-dot{position:absolute;left:0;top:calc(var(--cv-s-4) * -1 - 7px)}
${S} .cv-tl-dot{width:12px;height:12px;border-radius:99px;background:var(--cv-tl-dot);box-shadow:0 0 0 3px var(--cv-paper)}
${S} .cv-tl-date{font-family:var(--cv-font-label);font-size:var(--cv-t-xs);letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-muted)}
${S} .cv-tl-label{font-family:var(--cv-font-text);font-size:var(--cv-t-md);font-weight:600;color:var(--cv-ink);line-height:1.25}
${S} .cv-tl-note{font-size:var(--cv-t-sm);color:var(--cv-ink-2);line-height:1.35}
${S} .cv-tl-hot .cv-tl-label{color:var(--cv-accent)}
${S} .cv-tl-hot .cv-tl-dot{transform:scale(1.35)}
${S} .cv-waffle{display:flex;flex-direction:column;gap:var(--cv-s-2)}
${S} .cv-waffle svg{max-width:100%;height:auto}
${S} .cv-multiples{display:grid;grid-template-columns:repeat(auto-fit,minmax(var(--cv-mult-min,118px),1fr));gap:var(--cv-s-3)}
${S} .cv-mult{min-width:0;display:flex;flex-direction:column;gap:2px}
${S} .cv-mult-label{font-family:var(--cv-font-label);font-size:var(--cv-t-xs);letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${S} .cv-mult-row{display:flex;align-items:baseline;gap:var(--cv-s-2);flex-wrap:wrap}
${S} .cv-mult-value{font-family:var(--cv-font-num);font-size:var(--cv-t-xl);font-weight:var(--cv-display-weight);font-variant-numeric:tabular-nums;line-height:1.05;color:var(--cv-ink)}
${S} .cv-mult-spark{display:block;width:100%;height:26px;margin-top:2px}
${S} .cv-mult-note{font-size:var(--cv-t-xs);color:var(--cv-muted);line-height:1.3}
${S} .cv-tilemap{overflow:visible}
${S} .cv-anno{font-family:var(--cv-font-hand);font-size:12.5px;font-weight:600}
${S} .cv-anno-line{stroke-width:1.1;fill:none}
${S} .cv-anno-dot{stroke:var(--cv-paper);stroke-width:1.5}
${S} .cv-bignum{display:flex;flex-direction:column;align-items:flex-start;gap:var(--cv-s-2);container-type:inline-size}
${S} .cv-bignum-label{font-family:var(--cv-font-label);font-size:var(--cv-t-sm);letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-muted)}
${S} .cv-bignum-n{font-family:var(--cv-font-num);font-weight:var(--cv-display-weight);font-size:clamp(44px,30cqi,240px);line-height:0.86;letter-spacing:-0.04em;font-variant-numeric:tabular-nums lining-nums;white-space:nowrap}
${S} .cv-bignum-unit{font-size:0.36em;letter-spacing:0;color:var(--cv-muted);margin:0 0.06em;font-weight:500}
${S} .cv-bignum-sub{font-family:var(--cv-font-text);font-size:var(--cv-t-lg);color:var(--cv-ink-2);line-height:1.35;max-width:34ch;text-wrap:pretty}
${S} .cv-bare-quote{margin:0;position:relative;padding-left:0.62em}
${S} .cv-bare-quote blockquote{margin:0;font-family:var(--cv-font-display);font-size:clamp(24px,6.4vw,64px);line-height:1.08;font-weight:var(--cv-display-weight);color:var(--cv-ink);text-wrap:balance;letter-spacing:-0.01em}
${S} .cv-bare-quote blockquote::before{content:"“";position:absolute;left:-0.04em;top:-0.06em;font-size:1.9em;line-height:1;color:var(--cv-accent);font-family:var(--cv-font-display)}
${S} .cv-bare-quote figcaption{margin-top:var(--cv-s-3);font-family:var(--cv-font-label);font-size:var(--cv-t-sm);letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-ink-2)}
${S} .cv-bare-quote figcaption span{color:var(--cv-muted)}
${S} .cv-annotated{position:relative}
${S} .cv-stars{display:inline-flex;align-items:center;gap:0.45em;vertical-align:-0.15em}
${S} .cv-stars svg{display:block}
${S} .cv-stars-n{font-family:var(--cv-font-num);font-weight:var(--cv-display-weight);font-size:var(--cv-t-md);color:var(--cv-ink);font-variant-numeric:tabular-nums}
${S} .cv-stars-n small{font-size:0.7em;color:var(--cv-muted);font-weight:500}
${S} .cv-stars-note{font-family:var(--cv-font-label);font-size:var(--cv-t-xs);letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-muted)}
${S} .cv-wall{display:grid;grid-template-columns:repeat(var(--cv-cols,3),minmax(0,1fr));grid-auto-rows:minmax(min-content,1fr);gap:clamp(14px,2vw,28px);height:100%;min-height:min-content}
${S} .cv-wall>.cv-card{min-height:min-content}
${S} .cv-card{display:flex;flex-direction:column;gap:var(--cv-s-2);min-width:0;min-height:0;margin:0}
${S} .cv-card-pic{position:relative;width:100%;aspect-ratio:var(--cv-card-ratio,3/4);border-radius:var(--cv-radius-sm);overflow:hidden;background:color-mix(in oklab,var(--cv-rule) 60%,transparent)}
${S} .cv-card-pic img{width:100%;height:100%;object-fit:cover;display:block}
${S} .cv-card[data-fit="contain"] .cv-card-pic img{object-fit:contain}
${S} .cv-wall .cv-card-pic{aspect-ratio:auto;flex:1 1 0;min-height:clamp(110px,20vh,640px)}
${S} .cv-wall .cv-card[data-span="2"]{grid-row:span 2}
${S} .cv-wall .cv-card[data-wide]{grid-column:span 2}
${S} .cv-card-ph{display:flex;align-items:center;justify-content:center;padding:var(--cv-s-3);text-align:center}
${S} .cv-card-ph span{font-family:var(--cv-font-display);font-size:var(--cv-t-lg);font-weight:var(--cv-display-weight);color:var(--cv-muted);line-height:1.15;text-wrap:balance}
${S} .cv-card-ph:not(.cv-card-failed),${S} .cv-ph-box{animation:cv-pulse 1.6s ease-in-out infinite}
${S} .cv-card-text{display:flex;flex-direction:column;gap:4px;min-width:0}
${S} .cv-card-title{font-family:var(--cv-font-display);font-size:var(--cv-t-xl);font-weight:var(--cv-display-weight);line-height:1.1;text-wrap:balance;color:var(--cv-ink)}
${S} .cv-card[data-span="2"] .cv-card-title{font-size:var(--cv-t-2xl)}
${S} .cv-card-line{margin:0;font-size:var(--cv-t-sm);color:var(--cv-ink-2);line-height:1.35;text-wrap:pretty}
${S} .cv-stat{display:flex;flex-direction:column;gap:var(--cv-s-3);min-width:0}
${S} .cv-stat-line{margin:0;font-size:var(--cv-t-lg);color:var(--cv-ink-2);line-height:1.38;max-width:42ch;text-wrap:pretty}
${S} .cv-stat-source,${S} .cv-ph-label,${S} .cv-step-when,${S} .cv-side-label{font-family:var(--cv-font-label);font-size:var(--cv-t-xs);letter-spacing:var(--cv-label-tracking);text-transform:var(--cv-label-case);color:var(--cv-muted);line-height:1.25}
${S} .cv-steps{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);border-top:3px solid var(--cv-ink)}
${S} .cv-steps.cv-steps-col{grid-auto-flow:row;grid-auto-rows:minmax(0,auto);border-top:0;border-left:3px solid var(--cv-ink)}
${S} .cv-step{padding:var(--cv-s-3) var(--cv-s-3) 0;border-left:1px solid var(--cv-rule);display:flex;flex-direction:column;gap:4px;min-width:0}
${S} .cv-steps-col .cv-step{border-left:0;border-top:1px solid var(--cv-rule);padding:var(--cv-s-3)}
${S} .cv-step[data-tone="key"]{background:color-mix(in oklab,var(--cv-accent) 12%,transparent)}
${S} .cv-step-title{font-family:var(--cv-font-display);font-size:var(--cv-t-xl);font-weight:var(--cv-display-weight);line-height:1.12;color:var(--cv-ink);text-wrap:balance}
${S} .cv-step-line{margin:0;font-size:var(--cv-t-sm);color:var(--cv-ink-2);line-height:1.4}
${S} .cv-sides{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:clamp(24px,4vw,64px)}
${S} .cv-side{border-top:3px solid var(--cv-ink);padding-top:var(--cv-s-3);display:flex;flex-direction:column;gap:var(--cv-s-3);min-width:0}
${S} .cv-side[data-verdict]{border-top-color:var(--cv-accent)}
${S} .cv-side-head{display:flex;justify-content:space-between;align-items:center;gap:var(--cv-s-2)}
${S} .cv-side-title{font-family:var(--cv-font-display);font-size:var(--cv-t-2xl);font-weight:var(--cv-display-weight);line-height:1.06;color:var(--cv-ink);text-wrap:balance}
${S} .cv-side-points{margin:0;padding-left:1.1em;font-size:var(--cv-t-md);color:var(--cv-ink-2);line-height:1.45}
${S} .cv-side-points li+li{margin-top:0.3em}
${S} .cv-quote blockquote{margin:0;font:inherit}
${S} .cv-placeholder{display:flex;flex-direction:column;gap:var(--cv-s-2);min-height:clamp(80px,14vh,420px)}
${S} .cv-ph-box{flex:1;min-height:clamp(60px,10vh,320px);border-radius:var(--cv-radius-sm);background:color-mix(in oklab,var(--cv-rule) 55%,transparent)}
@keyframes cv-pulse{0%,100%{opacity:.55}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){${S} .cv-card-ph,${S} .cv-ph-box{animation:none}}
@media (max-width:520px){${S} .cv-sides{grid-auto-flow:row;grid-auto-columns:auto;gap:var(--cv-s-4)}${S} .cv-steps:not(.cv-steps-col){grid-auto-flow:row;grid-auto-columns:auto;border-top:0;border-left:3px solid var(--cv-ink)}${S} .cv-steps:not(.cv-steps-col) .cv-step{border-left:0;border-top:1px solid var(--cv-rule);padding:var(--cv-s-3)}}
${S} .cv-callout-pin{position:absolute;width:0;height:0;color:var(--cv-callout-color,var(--cv-ink))}
${S} .cv-callout-leader{position:absolute;overflow:visible;pointer-events:none}
${S} .cv-callout-leader line{stroke:var(--cv-callout-color,var(--cv-ink));stroke-width:1.1}
${S} .cv-callout-dot{position:absolute;left:-4px;top:-4px;width:8px;height:8px;border-radius:99px;background:var(--cv-callout-color,var(--cv-ink));box-shadow:0 0 0 2px var(--cv-paper)}
${S} .cv-callout-text{position:absolute;font-family:var(--cv-font-hand);font-size:var(--cv-t-sm);font-weight:600;line-height:1.3;color:var(--cv-callout-color,var(--cv-ink))}
`;

const LOOK_CSS: Record<OrganicLook, (S: string) => string> = {
  editorial: (S) => `
${S} .cv-h1,${S} .cv-h2{font-weight:600}
${S} .cv-quote{font-style:italic;font-size:var(--cv-t-2xl);line-height:1.12}
${S} .cv-quote::before{content:"“";display:block;font-size:2.2em;line-height:0.6;color:var(--cv-accent);margin-bottom:0.08em;font-style:normal}
${S} .cv-dropcap::first-letter{float:left;font-family:var(--cv-font-display);font-size:3.4em;line-height:0.82;padding:0.06em 0.08em 0 0;color:var(--cv-ink);font-weight:600}
${S} .cv-mult{border-top:1px solid var(--cv-rule-strong);padding-top:var(--cv-s-2)}
${S} .cv-table th{border-bottom-width:2px}
${S} .cv-body{font-size:var(--cv-t-lg);line-height:1.5}
${S} .cv-tl-label{font-family:var(--cv-font-display)}
${S} .cv-anno,${S} .cv-callout-text{font-family:var(--cv-font-margin);font-style:italic;font-weight:500}
${S} .cv-bare-quote blockquote{font-style:italic;font-weight:500}
`,
  field: (S) => `
${S} .cv-h1,${S} .cv-h2,${S} .cv-h3{font-weight:400;letter-spacing:0}
${S} .cv-kicker{font-family:var(--cv-font-hand);font-size:var(--cv-t-md);font-weight:600;letter-spacing:0;text-transform:none}
${S} .cv-label{font-family:var(--cv-font-hand);font-size:var(--cv-t-sm);letter-spacing:0;text-transform:none;color:var(--cv-ink-2)}
${S} .cv-hl{background:linear-gradient(100deg,transparent 2%,var(--cv-highlight) 4%,var(--cv-highlight) 94%,transparent 97%);border-radius:0.3em;padding:0 0.2em}
${S} .cv-quote{font-family:var(--cv-font-hand);font-size:var(--cv-t-xl);font-weight:600}
${S} .cv-mult{border-top:2px solid var(--cv-ink);padding-top:var(--cv-s-2)}
${S} .cv-series{stroke-width:2.8}
${S} .cv-end-label,${S} .cv-axis,${S} .cv-value{font-family:var(--cv-font-hand)}
${S} .cv-end-label{font-size:13px}
${S} .cv-tl-label{font-family:var(--cv-font-hand);font-size:var(--cv-t-lg)}
${S} .cv-hbar-track{height:0.9em;border-radius:99px}
${S} .cv-hbar-fill{border-radius:99px}
${S} .cv-delta{font-family:var(--cv-font-hand);font-size:var(--cv-t-sm);border-radius:99px}
`,
  instrument: (S) => `
${S} .cv-kicker{color:var(--cv-muted);font-weight:500}
${S} .cv-num{font-weight:600;letter-spacing:-0.01em}
${S} .cv-mult{border-left:1px solid var(--cv-rule);padding:0 var(--cv-s-3) var(--cv-s-1)}
${S} .cv-mult-value{font-size:var(--cv-t-lg)}
${S} .cv-grid-line{stroke-dasharray:none;opacity:0.7}
${S} .cv-table{font-size:var(--cv-t-xs);font-family:var(--cv-font-label)}
${S} .cv-table td{padding:3px var(--cv-s-2)}
${S} .cv-table th{border-bottom-color:var(--cv-rule)}
${S} .cv-tl-label{font-size:var(--cv-t-sm)}
${S} .cv-tl-dot{width:8px;height:8px;border-radius:1px}
${S} .cv-tl-column .cv-tl-dot{left:-25px}
${S} .cv-tl-row{border-top-width:1px}
${S} .cv-split-bar{height:16px}
${S} .cv-hbar-track{height:0.6em;border-radius:1px}
${S} .cv-hbar-label{font-size:var(--cv-t-xs)}
${S} .cv-hbar-value{font-family:var(--cv-font-label);font-size:var(--cv-t-xs)}
${S} .cv-delta{border-radius:1px}
${S} .cv-anno,${S} .cv-callout-text{font-family:var(--cv-font-label);font-size:11px;font-weight:500;letter-spacing:0.02em}
${S} .cv-bignum-n{letter-spacing:-0.02em}
`,
};

/** The kit's classes for a look, under a scope selector ("" for a frame, ".cv-scope" for the page). */
export function kitCss(look: OrganicLook, scope: string): string {
  return BASE(scope) + LOOK_CSS[look](scope);
}

/** A look's token declarations on BB's current theme, under a selector. */
export function tokenCss(look: OrganicLook, theme: BbTheme, selector: string): string {
  return `${selector}{${tokenDeclarations(look, theme)};color-scheme:${theme.mode}}`;
}
