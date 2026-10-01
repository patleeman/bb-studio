// A plugin outside BB Studio, staged so captures show that its sidebar row stays.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "forecast",
    title: "Forecast",
    icon: "staged-forecast/sun",
    path: "forecast",
    component: () => <div style={{ padding: 24 }}>Sunny, 21°C</div>,
  });
});
