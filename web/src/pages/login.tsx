import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { caldav } from '@/api'
import { hasSession, saveSession } from '@/state/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// The app's visual atom is the coloured collection dot — four of them make
// the mark: calendars and people sharing one place.
const MARK_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#8B5CF6']

function LogoMark() {
  return (
    <div
      aria-hidden
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 10px)',
        gap: 4,
        padding: 9,
        borderRadius: 10,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--surface-shadow)',
      }}
    >
      {MARK_COLORS.map((c) => (
        <span key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
      ))}
    </div>
  )
}

export function LoginPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // If the server doesn't require auth (dev / single-user mode), skip login.
  useEffect(() => {
    if (hasSession()) return
    let cancelled = false
    caldav.whoami()
      .then(() => { if (!cancelled) void navigate('/today', { replace: true }) })
      .catch(() => { /* credentials required — stay on the login form */ })
    return () => { cancelled = true }
  }, [navigate])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true)
    setError(null)
    caldav.configure({ username: username.trim(), password })
    try {
      await caldav.whoami()
      saveSession({ username: username.trim(), password })
      qc.clear()
      void navigate('/today', { replace: true })
    } catch {
      caldav.configure(null)
      setError('That username and password don’t match. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        padding: 24,
        background: 'var(--sidebar)',
      }}
    >
      {/* Identity */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <LogoMark />
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--foreground)',
              margin: 0,
            }}
          >
            CalStakk
          </h1>
          <p style={{ fontSize: 15, color: 'var(--muted-foreground)', margin: '4px 0 0' }}>
            Your calendars and tasks, in one place
          </p>
        </div>
      </div>

      {/* Sign-in card */}
      <form
        onSubmit={(e) => void submit(e)}
        style={{
          width: '100%',
          maxWidth: 360,
          padding: 28,
          borderRadius: 14,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--surface-shadow-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p
            role="alert"
            style={{
              fontSize: 14,
              lineHeight: 1.45,
              color: 'var(--destructive)',
              background: 'color-mix(in srgb, var(--destructive) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--destructive) 25%, transparent)',
              borderRadius: 8,
              padding: '8px 12px',
              margin: 0,
            }}
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={busy || !username.trim() || !password}
          style={{ width: '100%' }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      {/* A calendar app knows what day it is */}
      <p style={{ fontSize: 13.5, color: 'var(--ui-text-muted)', margin: 0 }}>
        {format(new Date(), 'EEEE d MMMM yyyy')}
      </p>
    </div>
  )
}
