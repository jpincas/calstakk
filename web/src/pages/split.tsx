import { Columns2 } from 'lucide-react'

export function SplitPage() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
      }}
    >
      <Columns2 style={{ width: 28, height: 28, color: '#3A3A46' }} strokeWidth={1.5} />
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 18, fontWeight: 500, color: 'rgba(255,255,255,0.5)', margin: 0 }}>
          Split view
        </p>
        <p style={{ fontSize: 16, color: '#3A3A46', margin: '4px 0 0' }}>
          Side-by-side calendar and tasks — coming soon.
        </p>
      </div>
    </div>
  )
}
