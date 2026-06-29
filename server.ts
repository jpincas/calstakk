// CalStakk server entry point.
// Usage: deno run --unstable-kv --allow-net --allow-read --allow-write --allow-env server.ts
//
// Flags:
//   --port=<n>    Listen port (default 5232)
//   --memory      Use in-memory storage instead of Deno KV (no persistence)
//
// Env vars:
//   CALSTAKK_KV_PATH   Path to the KV database file (default: Deno default location)

import { createHandler } from "./src/protocol.ts";
import { MemoryStorage } from "./src/storage.ts";
import { KVStorage } from "./src/storage_kv.ts";
import type { Storage } from "./src/storage.ts";

const port = parseInt(Deno.args.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "") || 5232;
const useMemory = Deno.args.includes("--memory");

let storage: Storage;
if (useMemory) {
  storage = new MemoryStorage();
  console.log("Storage: in-memory (no persistence)");
} else {
  const kvPath = Deno.env.get("CALSTAKK_KV_PATH");
  const kv = await Deno.openKv(kvPath);
  storage = new KVStorage(kv);
  console.log(`Storage: Deno KV${kvPath ? ` (${kvPath})` : " (default)"}`);
}

const handler = createHandler(storage);

console.log(`CalStakk listening on http://localhost:${port}`);
console.log(`  Principal:     http://localhost:${port}/calstakk`);
console.log(`  Calendar home: http://localhost:${port}/calstakk/calendars`);

Deno.serve({ port }, handler);
