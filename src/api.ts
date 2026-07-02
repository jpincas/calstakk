// Admin / account JSON API.
//
// User provisioning has no CalDAV/WebDAV specification, so this small JSON API
// sits alongside the DAV surface under /api/. Everything else (sharing, ACLs,
// principal search) stays on the spec'd DAV paths.
//
//   GET    /api/me                → identity of the authenticated user
//   GET    /api/users             → list users               (admin only)
//   POST   /api/users             → create user              (admin only)
//   PATCH  /api/users/{username}  → update user / reset pass (admin only)
//   DELETE /api/users/{username}  → delete user + their data (admin only)

import type { User } from "./types.ts";
import { DEFAULT_CALENDAR_NAME } from "./types.ts";
import type { Storage } from "./storage.ts";
import { hashPassword } from "./auth.ts";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

interface PublicUser {
  username: string;
  displayName: string;
  email: string;
  timezone: string;
  isAdmin: boolean;
}

function publicUser(u: User): PublicUser {
  return {
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    timezone: u.timezone,
    isAdmin: u.isAdmin,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, message: string): Response {
  return json(status, { error: message });
}

export function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

export async function handleApi(
  req: Request,
  path: string,
  user: User,
  storage: Storage,
): Promise<Response> {
  const method = req.method.toUpperCase();

  if (path === "/api/me") {
    if (method !== "GET") return jsonError(405, "Method not allowed");
    return json(200, publicUser(user));
  }

  if (path === "/api/users" || path.startsWith("/api/users/")) {
    if (!user.isAdmin) return jsonError(403, "Admin access required");
    return await handleUsers(req, path, method, user, storage);
  }

  return jsonError(404, "Not found");
}

async function handleUsers(
  req: Request,
  path: string,
  method: string,
  admin: User,
  storage: Storage,
): Promise<Response> {
  const target = path === "/api/users" ? null : decodeURIComponent(path.slice("/api/users/".length));

  if (target === null) {
    if (method === "GET") {
      const users = await storage.listUsers();
      users.sort((a, b) => a.username.localeCompare(b.username));
      return json(200, users.map(publicUser));
    }
    if (method === "POST") return await createUser(req, storage);
    return jsonError(405, "Method not allowed");
  }

  if (target.includes("/")) return jsonError(404, "Not found");
  const existing = await storage.getUser(target);
  if (!existing) return jsonError(404, `Unknown user: ${target}`);

  if (method === "PATCH") return await updateUser(req, existing, storage);
  if (method === "DELETE") {
    if (existing.isAdmin) return jsonError(403, "The admin account cannot be deleted");
    if (existing.username === admin.username) return jsonError(403, "Cannot delete your own account");
    await storage.deleteUser(existing.username);
    return new Response(null, { status: 204 });
  }
  return jsonError(405, "Method not allowed");
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  return typeof v === "string" ? v : undefined;
}

async function createUser(req: Request, storage: Storage): Promise<Response> {
  const body = await readJsonBody(req);
  if (!body) return jsonError(400, "Invalid JSON body");

  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!USERNAME_RE.test(username)) {
    return jsonError(400, "Invalid username: lowercase letters, digits, '.', '_', '-'; max 64 chars");
  }
  if (username === "inbox" || username === "outbox") {
    return jsonError(400, "Reserved username");
  }
  if (!password) return jsonError(400, "Password is required");

  if (await storage.getUser(username)) return jsonError(409, `User ${username} already exists`);

  const email = optionalString(body, "email") ?? "";
  if (email && (await storage.getUserByEmail(email))) {
    return jsonError(409, `Email ${email} is already in use`);
  }

  const user: User = {
    username,
    passwordHash: await hashPassword(password),
    displayName: optionalString(body, "displayName") || username,
    email,
    timezone: optionalString(body, "timezone") || "UTC",
    isAdmin: false, // exactly one admin: the configured owner
  };
  await storage.createUser(user);
  await storage.createCalendar(username, DEFAULT_CALENDAR_NAME, "Default Calendar");
  return json(201, publicUser(user));
}

async function updateUser(req: Request, existing: User, storage: Storage): Promise<Response> {
  const body = await readJsonBody(req);
  if (!body) return jsonError(400, "Invalid JSON body");

  const updates: Partial<Pick<User, "passwordHash" | "displayName" | "email" | "timezone">> = {};
  const password = optionalString(body, "password");
  if (password !== undefined) {
    if (!password) return jsonError(400, "Password cannot be empty");
    updates.passwordHash = await hashPassword(password);
  }
  const displayName = optionalString(body, "displayName");
  if (displayName !== undefined) {
    if (!displayName.trim()) return jsonError(400, "Display name cannot be empty");
    updates.displayName = displayName.trim();
  }
  const email = optionalString(body, "email");
  if (email !== undefined) {
    if (email) {
      const inUse = await storage.getUserByEmail(email);
      if (inUse && inUse.username !== existing.username) {
        return jsonError(409, `Email ${email} is already in use`);
      }
    }
    updates.email = email;
  }
  const timezone = optionalString(body, "timezone");
  if (timezone !== undefined) updates.timezone = timezone || "UTC";

  if (Object.keys(updates).length === 0) return jsonError(400, "No updatable fields provided");
  await storage.updateUser(existing.username, updates);
  const updated = await storage.getUser(existing.username);
  return json(200, publicUser(updated!));
}
