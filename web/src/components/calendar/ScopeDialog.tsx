import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

export type EditScope = 'this' | 'future' | 'all'

export interface ScopeOption {
  value: EditScope
  label: string
  hint?: string
}

interface Props {
  open: boolean
  title: string
  options: ScopeOption[]
  /** Shown above the choices, e.g. the overrides-reset consequence. */
  warning?: string
  accent: string
  onChoose: (scope: EditScope) => void
  onCancel: () => void
}

/**
 * The "This event / This and future / All events" chooser, shown at the moment
 * of a save/delete/move on a recurring occurrence (Google/Apple muscle memory —
 * the edit dialog itself stays identical for recurring and plain events).
 */
export function ScopeDialog({ open, title, options, warning, accent, onChoose, onCancel }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={onCancel} />
      <div
        role="dialog"
        aria-label={title}
        style={{
          position: 'relative', zIndex: 71, width: 340, maxWidth: 'calc(100vw - 32px)',
          background: 'var(--background)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,0.25)', padding: 16,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--foreground)', marginBottom: warning ? 8 : 12 }}>
          {title}
        </div>
        {warning && (
          <div
            style={{
              display: 'flex', gap: 7, alignItems: 'flex-start',
              fontSize: 14, lineHeight: 1.45, color: 'var(--muted-foreground)',
              background: 'color-mix(in srgb, orange 8%, var(--background))',
              border: '1px solid color-mix(in srgb, orange 30%, var(--border))',
              borderRadius: 8, padding: '7px 9px', marginBottom: 12,
            }}
          >
            <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: '#d97706' }} />
            <span>{warning}</span>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onChoose(o.value)}
              style={{
                textAlign: 'left', padding: '8px 11px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--background)',
                cursor: 'pointer', transition: 'border-color 90ms, background 90ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              <span style={{ display: 'block', fontSize: 16, fontWeight: 500, color: 'var(--foreground)' }}>{o.label}</span>
              {o.hint && <span style={{ display: 'block', fontSize: 13.5, color: 'var(--muted-foreground)', marginTop: 1 }}>{o.hint}</span>}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)',
              background: 'none', fontSize: 15, cursor: 'pointer', color: 'var(--muted-foreground)',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
