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

export const PRINCIPAL_PATH = "/calstakk";
export const CALENDAR_HOME_PATH = "/calstakk/calendars";
export const INBOX_PATH = "/calstakk/inbox/";
export const OUTBOX_PATH = "/calstakk/outbox/";
export const DEFAULT_CALENDAR_NAME = "default";

export function collectionPath(name: string): string {
  return `${CALENDAR_HOME_PATH}/${name}`;
}

export function objectPath(collection: string, uid: string): string {
  return `${CALENDAR_HOME_PATH}/${collection}/${uid}.ics`;
}

export type ResourceType =
  | "root"
  | "principal"
  | "calendarHome"
  | "inbox"
  | "outbox"
  | "collection"
  | "object"
  | "unknown";

export function resourceTypeAtPath(path: string): ResourceType {
  const p = path.replace(/\/$/, "") || "/";
  if (p === INBOX_PATH.replace(/\/$/, "")) return "inbox";
  if (p === OUTBOX_PATH.replace(/\/$/, "")) return "outbox";
  const parts = p.split("/").filter(Boolean);
  switch (parts.length) {
    case 0: return "root";
    case 1: return "principal"; // /calstakk
    case 2: return "calendarHome"; // /calstakk/calendars
    case 3: return "collection"; // /calstakk/calendars/<name>
    case 4: return "object"; // /calstakk/calendars/<name>/<uid>.ics
    default: return "unknown";
  }
}

export function collectionNameFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[2] ?? "";
}

export function objectUIDFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const filename = parts[3] ?? "";
  return filename.replace(/\.ics$/, "");
}
