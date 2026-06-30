// Shared types for the CalStakk CalDAV server.

export class HTTPError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "HTTPError";
  }
}

export function httpError(code: number, msg: string): HTTPError {
  return new HTTPError(code, msg);
}

export const HTTP_STATUS: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  207: "Multi-Status",
  301: "Moved Permanently",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  412: "Precondition Failed",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
  501: "Not Implemented",
};

export function statusText(code: number): string {
  return HTTP_STATUS[code] ?? "Unknown";
}

export type Depth = "0" | "1" | "infinity";

export function parseDepth(header: string | null): Depth {
  if (header === "0") return "0";
  if (header === "infinity") return "infinity";
  return "1"; // default
}

// ─── User ─────────────────────────────────────────────────────────────────────

export interface User {
  username: string;
  /** bcrypt hash of the password. */
  passwordHash: string;
  displayName: string;
  /** Primary email — used for calendar-user-address-set and scheduling. */
  email: string;
  /** IANA timezone identifier. */
  timezone: string;
  /** Owner/admin flag — only one user has this set. */
  isAdmin: boolean;
}

// ─── Path helpers (per-user) ──────────────────────────────────────────────────

export const DEFAULT_CALENDAR_NAME = "default";

// Canonical sabre/dav pattern: /principals/<username> and /calendars/<username>/
export function principalPath(username: string): string {
  return `/principals/${username}`;
}

export function calendarHomePath(username: string): string {
  return `/calendars/${username}`;
}

export function inboxPath(username: string): string {
  return `/calendars/${username}/inbox`;
}

export function outboxPath(username: string): string {
  return `/calendars/${username}/outbox`;
}

export function collectionPath(username: string, name: string): string {
  return `/calendars/${username}/${name}`;
}

export function objectPath(username: string, collection: string, uid: string): string {
  return `/calendars/${username}/${collection}/${uid}.ics`;
}

// ─── Path parsing ─────────────────────────────────────────────────────────────

export type ResourceType =
  | "root"
  | "principals"      // /principals
  | "principal"       // /principals/<username>
  | "calendarHome"    // /calendars/<username>
  | "inbox"           // /calendars/<username>/inbox
  | "outbox"          // /calendars/<username>/outbox
  | "collection"      // /calendars/<username>/<name>
  | "object"          // /calendars/<username>/<name>/<uid>.ics
  | "wellknown"
  | "unknown";

export interface ParsedPath {
  type: ResourceType;
  username: string;   // empty for root/wellknown/principals
  collection: string; // empty unless collection/object
  uid: string;        // empty unless object (no .ics extension)
}

export function parsePath(path: string): ParsedPath {
  const p = path.replace(/\/$/, "") || "/";
  const parts = p.split("/").filter(Boolean);

  if (p === "/" || parts.length === 0) {
    return { type: "root", username: "", collection: "", uid: "" };
  }

  if (p === "/.well-known/caldav") {
    return { type: "wellknown", username: "", collection: "", uid: "" };
  }

  if (parts[0] === "principals") {
    if (parts.length === 1) return { type: "principals", username: "", collection: "", uid: "" };
    if (parts.length === 2) return { type: "principal", username: parts[1], collection: "", uid: "" };
    return { type: "unknown", username: parts[1], collection: "", uid: "" };
  }

  if (parts[0] === "calendars") {
    if (parts.length === 1) return { type: "root", username: "", collection: "", uid: "" };
    const username = parts[1];
    if (parts.length === 2) return { type: "calendarHome", username, collection: "", uid: "" };
    const segment = parts[2];
    if (segment === "inbox") return { type: "inbox", username, collection: "inbox", uid: "" };
    if (segment === "outbox") return { type: "outbox", username, collection: "outbox", uid: "" };
    if (parts.length === 3) return { type: "collection", username, collection: segment, uid: "" };
    if (parts.length === 4) {
      const uid = parts[3].replace(/\.ics$/, "");
      return { type: "object", username, collection: segment, uid };
    }
    return { type: "unknown", username, collection: "", uid: "" };
  }

  return { type: "unknown", username: "", collection: "", uid: "" };
}
