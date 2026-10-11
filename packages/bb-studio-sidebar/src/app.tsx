import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ThreadList } from "./ThreadList.js";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "thread-list",
    title: "Studio Sidebar",
    description: "Your threads by Studio Space: one Space at a time, its lead and pins on top, two-line rows with each thread's latest progress.",
    component: ThreadList,
  });
});
