// Session handling for HTTP Basic auth against the CalDAV server.
//
// Credentials are kept in localStorage so the SPA can restore the session on
// reload — acceptable for a private, self-hosted tool. When the server has no
// password configured (single-user dev mode) no session exists and every
// request succeeds unauthenticated.

import { caldav } from '@/api'

const SESSION_KEY = 'calstakk-session'
const COLLECTION_STORE_KEY = 'calstakk-collection'

export interface StoredSession {
  username: string
  password: string
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<StoredSession>
    if (typeof s?.username === 'string' && typeof s?.password === 'string') {
      return { username: s.username, password: s.password }
    }
    return null
  } catch {
    return null
  }
}

export function saveSession(session: StoredSession): void {
  const previous = loadSession()
  // Per-user UI state (active collection, hidden lists, …) must not leak
  // across accounts on the same browser.
  if (previous && previous.username !== session.username) {
    localStorage.removeItem(COLLECTION_STORE_KEY)
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  caldav.configure(session)
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(COLLECTION_STORE_KEY)
  caldav.configure(null)
}

/** Apply any stored session to the shared client. Call once at boot, before rendering. */
export function restoreSession(): void {
  const session = loadSession()
  if (session) caldav.configure(session)
}

export function hasSession(): boolean {
  return loadSession() !== null
}
