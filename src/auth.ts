// Password hashing and verification using SHA-256 + random salt.
// Format: "sha256:<salt>:<hash>"
// Suitable for single-tenant private server use. Upgrade to bcrypt for public-facing deployments.

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID().replace(/-/g, "");
  const hash = await sha256hex(`${salt}:${password}`);
  return `sha256:${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith("sha256:")) return false;
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const [, salt, expected] = parts;
  const actual = await sha256hex(`${salt}:${password}`);
  // Constant-time comparison to prevent timing attacks
  return constantTimeEqual(actual, expected);
}

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Parse an HTTP Basic Authorization header. Returns {username, password} or null. */
export function parseBasicAuth(header: string | null): { username: string; password: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return null;
  }
  const colonIdx = decoded.indexOf(":");
  if (colonIdx < 0) return null;
  return {
    username: decoded.slice(0, colonIdx),
    password: decoded.slice(colonIdx + 1),
  };
}
