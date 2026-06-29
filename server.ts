// CalStakk server entry point.
// Usage: deno run --unstable-kv --allow-net --allow-read --allow-write --allow-env server.ts
//
// Flags:
//   --memory      Use in-memory storage instead of Deno KV (no persistence)
//
// All other config is read from environment variables — see src/config.ts.

import { createHandler } from "./src/protocol.ts";
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

const handler = createHandler(storage, config);

const { host, port } = config.server;
console.log(`CalStakk listening on http://${host}:${port}`);
console.log(`  Principal:     http://${host}:${port}/calstakk`);
console.log(`  Calendar home: http://${host}:${port}/calstakk/calendars`);
if (config.user.password) {
  console.log(`  Auth:          ${config.user.username} / (password set)`);
} else {
  console.log("  Auth:          none (set CALSTAKK_PASSWORD to enable)");
}

Deno.serve({ hostname: host, port }, handler);
