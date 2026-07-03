import type { ReactNode } from 'react'

/**
 * Icon-style control for the PageBar: no border/box chrome, just the glyph
 * with a soft hover backdrop. `colored` = the bar has an accent background
 * (white-on-colour); `danger` = armed destructive state (solid red).
 */
export function PageBarIconButton({ onClick, title, colored = false, danger = false, children }: {
  onClick: () => void
  title?: string
  colored?: boolean
  danger?: boolean
  children: ReactNode
}) {
  const restColor = danger ? '#fff' : colored ? 'rgba(255,255,255,0.85)' : 'var(--muted-foreground)'
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        minWidth: 32, height: 32, padding: '0 6px', borderRadius: 7,
        border: 'none',
        background: danger ? 'var(--destructive)' : 'transparent',
        color: restColor,
        cursor: 'pointer',
        transition: 'background 100ms, color 100ms',
        fontSize: 16, fontWeight: 600,
      }}
      onMouseEnter={(e) => {
        if (danger) return
        e.currentTarget.style.background = colored ? 'rgba(255,255,255,0.18)' : 'var(--hover-bg)'
        e.currentTarget.style.color = colored ? '#fff' : 'var(--foreground)'
      }}
      onMouseLeave={(e) => {
        if (danger) return
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = restColor
      }}
    >
      {children}
    </button>
  )
}

interface PageBarProps {
  icon?: ReactNode
  accentColor?: string
  title: ReactNode
  detail?: ReactNode
  controls?: ReactNode
}

export function PageBar({ icon, accentColor, title, detail, controls }: PageBarProps) {
  const colored = !!accentColor
  return (
    <div
      style={{
        flexShrink: 0,
        height: 52,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 10,
        background: colored ? accentColor : 'var(--card)',
        borderBottom: colored ? 'none' : '1px solid var(--border)',
        color: colored ? '#fff' : 'var(--foreground)',
      }}
    >
      {icon && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: 20, fontWeight: 700, color: 'inherit', flexShrink: 0 }}>
        {title}
      </div>
      {detail !== undefined && detail !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 17,
            color: colored ? 'rgba(255,255,255,0.75)' : 'var(--muted-foreground)',
          }}
        >
          {detail}
        </div>
      )}
      <div style={{ flex: 1 }} />
      {controls && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {controls}
        </div>
      )}
    </div>
  )
}
