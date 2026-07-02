import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link } from 'lucide-react'
import { caldav } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Props {
  collection: string
  accentColor: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PRIORITY_OPTS = [
  { label: 'None', value: 0 },
  { label: 'Low', value: 7 },
  { label: 'Medium', value: 5 },
  { label: 'High', value: 2 },
] as const

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: 16,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted-foreground)',
  marginBottom: 4,
}

const emptyState = () => ({
  summary: '',
  description: '',
  due: '',
  status: 'NEEDS-ACTION',
  priority: 0,
  url: '',
  categories: [] as string[],
})

export function NewTaskDialog({ collection, accentColor, open, onOpenChange }: Props) {
  const qc = useQueryClient()
  const [form, setForm] = useState(emptyState())
  const [catInput, setCatInput] = useState('')

  const reset = () => { setForm(emptyState()); setCatInput('') }

  const create = useMutation({
    mutationFn: () =>
      caldav.createTodo(collection, {
        uid: crypto.randomUUID(),
        summary: form.summary,
        description: form.description.trim() || undefined,
        due: form.due ? form.due.replace(/-/g, '') : undefined,
        status: form.status,
        priority: form.priority || undefined,
        url: form.url.trim() || undefined,
        categories: form.categories.length ? form.categories : undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['todos', collection] })
      reset()
      onOpenChange(false)
      toast.success('Task created')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const addCat = (v: string) => {
    const t = v.trim()
    if (t && !form.categories.includes(t)) setForm({ ...form, categories: [...form.categories, t] })
    setCatInput('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent>
        <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <Label>Title</Label>
            <Input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} autoFocus />
          </div>

          <div>
            <span style={labelStyle}>Description</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Add notes…"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <span style={labelStyle}>Due</span>
              <input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={labelStyle}>Status</span>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inputStyle}>
                <option value="NEEDS-ACTION">To do</option>
                <option value="IN-PROCESS">In progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Priority pills */}
          <div>
            <span style={labelStyle}>Priority</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {PRIORITY_OPTS.map(({ label, value }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setForm({ ...form, priority: value })}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 20,
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 80ms',
                    border: `1px solid ${form.priority === value ? accentColor : 'var(--border)'}`,
                    background: form.priority === value ? accentColor : 'var(--background)',
                    color: form.priority === value ? '#fff' : 'var(--muted-foreground)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* URL */}
          <div>
            <span style={labelStyle}>URL</span>
            <div style={{ position: 'relative' }}>
              <Link
                style={{
                  position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                  width: 12, height: 12, color: 'var(--muted-foreground)', pointerEvents: 'none',
                }}
              />
              <input
                type="url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://…"
                style={{ ...inputStyle, paddingLeft: 26 }}
              />
            </div>
          </div>

          {/* Tags chip input */}
          <div>
            <span style={labelStyle}>Tags</span>
            <div
              style={{
                display: 'flex', flexWrap: 'wrap', gap: 5,
                padding: '4px 6px', borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--background)',
                minHeight: 32, alignItems: 'center',
              }}
            >
              {form.categories.map((cat) => (
                <span
                  key={cat}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    padding: '1px 7px', borderRadius: 20,
                    background: `${accentColor}22`, color: accentColor,
                    fontSize: 14, fontWeight: 500,
                  }}
                >
                  {cat}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, categories: form.categories.filter((c) => c !== cat) })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', lineHeight: 1, fontSize: 17 }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={catInput}
                onChange={(e) => setCatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCat(catInput) }
                  if (e.key === 'Backspace' && !catInput && form.categories.length) {
                    setForm({ ...form, categories: form.categories.slice(0, -1) })
                  }
                }}
                onBlur={() => catInput.trim() && addCat(catInput)}
                placeholder={form.categories.length > 0 ? '' : 'Add tags…'}
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 16, color: 'var(--foreground)', fontFamily: 'inherit',
                  minWidth: 80, flex: 1,
                }}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !form.summary.trim()}
            style={{ background: accentColor, color: '#fff', border: 'none' }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
