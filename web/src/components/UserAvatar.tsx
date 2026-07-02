// People get the same treatment as collections: a stable colour from the
// shared palette (see userColor in lib/colors.ts).
import { userColor } from '@/lib/colors'

function initials(displayName: string, username: string): string {
  const source = (displayName || username).trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase() || '?'
}

interface Props {
  username: string
  displayName?: string
  size?: number
}

export function UserAvatar({ username, displayName = '', size = 26 }: Props) {
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: userColor(username),
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.4),
        fontWeight: 600,
        letterSpacing: '0.02em',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {initials(displayName, username)}
    </div>
  )
}
