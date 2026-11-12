// What a widget added from the picker starts with, so it shows something
// right away; its settings open next.
import type { Op, WidgetType } from "../shared";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function sampleOp(type: WidgetType): Op {
  switch (type) {
    case "stat":
      return { op: "add", type, title: "Metric", source: { kind: "static", data: { value: 1280, delta: "+4.2%", trend: "up", series: [980, 1040, 1010, 1120, 1190, 1230, 1280] } } };
    case "line":
    case "bar":
    case "area":
      return { op: "add", type, title: "Weekly", source: { kind: "static", data: WEEK.map((day, index) => ({ day, visits: [120, 180, 150, 210, 260, 190, 230][index], signups: [8, 12, 9, 15, 21, 14, 17][index] })) } };
    case "pie":
      return { op: "add", type, title: "Sources", source: { kind: "static", data: [{ source: "Search", value: 48 }, { source: "Direct", value: 27 }, { source: "Social", value: 15 }, { source: "Email", value: 10 }] } };
    case "table":
      return { op: "add", type, title: "Table", source: { kind: "static", data: [{ name: "Alpha", owner: "Sam", status: "On track" }, { name: "Beta", owner: "Kim", status: "At risk" }] } };
    case "list":
      return { op: "add", type, title: "Feed", source: { kind: "static", data: [{ title: "Add an RSS feed or JSON URL in settings", summary: "Or let an agent push items with widget_set_data." }] } };
    case "ticker":
      return { op: "add", type, title: null, source: { kind: "static", data: [{ label: "AAPL", value: "231.40", delta: "+0.8%" }, { label: "MSFT", value: "428.10", delta: "-0.3%" }, { label: "BTC", value: "64,210", delta: "+2.1%" }] } };
    case "note":
      return { op: "add", type, title: "Note", options: { markdown: "**Notes** go here. Markdown works: lists, links and `code`." } };
    case "embed":
      return { op: "add", type, title: "Embed", options: {} };
    case "clock":
      return { op: "add", type, title: null, options: {} };
    case "image":
      return { op: "add", type, title: null, options: {} };
    case "progress":
      return { op: "add", type, title: "Goal", options: { max: 100, unit: "%" }, source: { kind: "static", data: { value: 64, label: "Quarter goal" } } };
    case "custom":
      return {
        op: "add", type, title: "Custom",
        html: "<div id=\"out\" style=\"padding:12px;font-size:28px;font-weight:600\"></div>\n<script>\naddEventListener('bbwidget', (e) => {\n  out.textContent = JSON.stringify(e.detail.data);\n  out.style.color = e.detail.theme.colors.foreground;\n});\n</script>",
        source: { kind: "static", data: 42 },
      };
  }
}
