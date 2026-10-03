import sidebar from "./source/server";
export async function registerServer(ctx: import("../runtime").ModuleContext) { await sidebar(ctx.bb); }
