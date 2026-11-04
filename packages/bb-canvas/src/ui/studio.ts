// Studio source the canvas page reuses, bundled into this plugin at build
// time: Dashboards' widget renderers and theme, Studio's markdown, small kit
// helpers, and Talk's dictation-field event names (a plain DOM contract).
// Frontend only, and no Studio server internals. At runtime the canvas talks
// to Studio only through supported paths: Talk's DOM field events, and the
// hands-free start event below (src/voice/live/ui/HandsFree.tsx listens).
export { cn, Icon } from "../../../bb-studio/src/kit/ui/index";
export { openAppPath } from "../../../bb-studio/src/kit/app/nav";
export { errorMessage } from "../../../bb-studio/src/kit/format";
export { useWidgetTheme } from "../../../bb-studio/src/dashboards/ui/theme";
export type { WidgetTheme } from "../../../bb-studio/src/dashboards/ui/custom-frame";
export { Markdown } from "../../../bb-studio/src/dashboards/ui/markdown";
export { columnLabel, imageSrc, listItems, readProgress, readStat, ScrollBody, tableOf, WidgetBody } from "../../../bb-studio/src/dashboards/ui/widgets";
export type { WidgetType, WidgetView } from "../../../bb-studio/src/dashboards/shared";
export { INSERT_EVENT, STATE_EVENT, TOGGLE_EVENT } from "../../../bb-studio/src/talk/ui/fields";
export { HANDSFREE_START_EVENT } from "../../../bb-studio/src/voice/live/shared";
