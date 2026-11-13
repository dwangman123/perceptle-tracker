// Serves the standings page and the nightly export, on this Mac only.
// Nothing else in the project is reachable: config.json holds phone numbers.
// Not part of the scanner binary, so changing it never touches Full Disk Access.
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const port = Number(process.env.PORT ?? 4118);

const routes: Record<string, { file: string; type: string }> = {
  "/": { file: join(root, "web", "index.html"), type: "text/html; charset=utf-8" },
  "/export.json": { file: join(root, "data", "export.json"), type: "application/json" },
};

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(req) {
    const route = routes[new URL(req.url).pathname];
    if (!route) return new Response("Not found", { status: 404 });
    const file = Bun.file(route.file);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file, { headers: { "content-type": route.type, "cache-control": "no-store" } });
  },
});

console.log(`Perceptle standings: http://localhost:${port}`);
