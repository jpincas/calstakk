import type { ReactNode } from 'react'

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
