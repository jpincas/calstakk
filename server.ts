// CalStakk server entry point.
// Usage: deno run --unstable-kv --allow-net --allow-read --allow-write --allow-env server.ts
//
// Flags:
//   --memory      Use in-memory storage instead of Deno KV (no persistence)
//
// All other config is read from environment variables — see src/config.ts.

import { serveDir } from "@std/http/file-server";
import { createHandler } from "./src/protocol.ts";
import { createMcpHttpHandler } from "./mcp/http.ts";
import { MemoryStorage } from "./src/storage.ts";
import { KVStorage } from "./src/storage_kv.ts";
import { loadConfig } from "./src/config.ts";
import type { Storage } from "./src/storage.ts";

const config = loadConfig();
const useMemory = Deno.args.includes("--memory");

let storage: Storage;
if (useMemory) {
  storage = new MemoryStorage();
  console.log("Storage: in-memory (no persistence)");
} else {
  const kv = await Deno.openKv(config.server.kvPath);
  storage = new KVStorage(kv);
  console.log(`Storage: Deno KV${config.server.kvPath ? ` (${config.server.kvPath})` : " (default)"}`);
}

const caldavHandler = createHandler(storage, config);
const mcpHandler = createMcpHttpHandler(caldavHandler);
const { host, port, webDir } = config.server;

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // MCP endpoint (streamable HTTP, stateless) for AI agents
  if (url.pathname === "/mcp") return mcpHandler(req);

  // Serve the React SPA at /app/
  if (url.pathname.startsWith("/app/") && webDir) {
    const resp = await serveDir(req, { fsRoot: webDir, urlRoot: "app", quiet: true });
    // SPA fallback: unknown paths (client-side routes) get index.html
    if (resp.status === 404) {
      try {
        const index = await Deno.readFile(`${webDir}/index.html`);
        return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      } catch {
        return resp;
      }
    }
    return resp;
  }

  return caldavHandler(req);
};

console.log(`CalStakk listening on http://${host}:${port}`);
console.log(`  Principal:     http://${host}:${port}/principals/${config.user.username}`);
console.log(`  Calendar home: http://${host}:${port}/calendars/${config.user.username}`);
console.log(`  Web UI:        http://${host}:${port}/app/${webDir ? "" : "(disabled — set CALSTAKK_WEB_DIR)"}`);
console.log(`  MCP:           http://${host}:${port}/mcp`);
if (config.user.password) {
  console.log(`  Auth:          ${config.user.username} / (password set)`);
} else {
  console.log("  Auth:          none (set CALSTAKK_PASSWORD to enable)");
}

Deno.serve({ hostname: host, port }, handler);
