import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  AlignLeft, Bell, CheckCircle2, Clock, Link, MapPin, Repeat, Tag, Trash2, X,
} from 'lucide-react'
import { collectionColor } from '@/lib/colors'
import {
  rruleToForm, formToRrule, toICalString, shiftSeries, scheduleChanged,
  type Occurrence, type RecurrenceForm, type SeriesEdits,
} from '@/lib/recur'
import type { Collection, EventFields } from '@/types'
import { RecurrenceEditor } from './RecurrenceEditor'
import { ScopeDialog, type EditScope } from './ScopeDialog'
import { useEventMutations } from './useEventMutations'

const REMINDERS = [
  { v: '', label: 'None' },
  { v: 'PT0S', label: 'At time of event' },
  { v: '-PT5M', label: '5 minutes before' },
  { v: '-PT15M', label: '15 minutes before' },
  { v: '-PT30M', label: '30 minutes before' },
  { v: '-PT1H', label: '1 hour before' },
  { v: '-P1D', label: '1 day before' },
] as const

const STATUSES = [
  { v: 'CONFIRMED', label: 'Confirmed' },
  { v: 'TENTATIVE', label: 'Tentative' },
  { v: 'CANCELLED', label: 'Cancelled' },
] as const

const SHOW_AS = [
  { v: 'OPAQUE', label: 'Busy' },
  { v: 'TRANSPARENT', label: 'Free' },
] as const

const DAY_MS = 24 * 60 * 60 * 1000

interface FormState {
  col: string
  summary: string
  allDay: boolean
  startDate: string // yyyy-MM-dd
  startTime: string // HH:mm
  endDate: string // inclusive for all-day display
  endTime: string
  recurrence: RecurrenceForm | null
  unsupportedRrule?: string
  reminder: string // '' none | trigger value | 'custom' (foreign, kept)
  location: string
  url: string
  description: string
  status: string // '' = unset (reads as confirmed)
  transp: string
  categories: string[]
}

function nextFullHour(): Date {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

function initialForm(
  occ: Occurrence | null,
  defaultCol: string,
  range?: { start: Date; end: Date; allDay: boolean },
): FormState {
  if (occ) {
    const f = occ.fields
    const allDay = occ.allDay
    // DTEND is exclusive; all-day pickers show the inclusive last day.
    const endShown = allDay ? new Date(occ.end.getTime() - DAY_MS) : occ.end
    const rrule = occ.master.rrule
    const asForm = rrule ? rruleToForm(rrule) : null
    return {
      col: defaultCol,
      summary: f.summary,
      allDay,
      startDate: format(occ.start, 'yyyy-MM-dd'),
      startTime: format(occ.start, 'HH:mm'),
      endDate: format(endShown < occ.start ? occ.start : endShown, 'yyyy-MM-dd'),
      endTime: format(occ.end, 'HH:mm'),
      recurrence: asForm,
      unsupportedRrule: rrule && !asForm ? rrule : undefined,
      reminder: f.reminder
        ? (REMINDERS.some((r) => r.v === f.reminder) ? f.reminder : 'custom')
        : '',
      location: f.location ?? '',
      url: f.url ?? '',
      description: f.description ?? '',
      status: f.status ?? '',
      transp: f.transp ?? 'OPAQUE',
      categories: f.categories ?? [],
    }
  }
  const start = range?.start ?? nextFullHour()
  const allDay = range?.allDay ?? false
  const end = range?.end ?? new Date(start.getTime() + 60 * 60_000)
  const endShown = allDay ? new Date(Math.max(start.getTime(), end.getTime() - DAY_MS)) : end
  return {
    col: defaultCol,
    summary: '',
    allDay,
    startDate: format(start, 'yyyy-MM-dd'),
    startTime: format(start, 'HH:mm'),
    endDate: format(endShown, 'yyyy-MM-dd'),
    endTime: format(endShown, 'HH:mm'),
    recurrence: null,
    reminder: '',
    location: '',
    url: '',
    description: '',
    status: '',
    transp: 'OPAQUE',
    categories: [],
  }
}

function parseLocal(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = /^\d{2}:\d{2}$/.test(time) ? time.split(':').map(Number) : [0, 0]
  return new Date(y, m - 1, d, h, min, 0)
}

interface Props {
  /** The occurrence being edited; null when creating. */
  occurrence: Occurrence | null
  /** Slot-create prefill (drag on the calendar grid). */
  initialRange?: { start: Date; end: Date; allDay: boolean }
  collections: Collection[]
  /** Creation target (new) or the occurrence's collection ref (edit). */
  colRef: string
  /** Offer the collection picker (creating from a multi-collection view). */
  showCollectionPicker: boolean
  readOnly: boolean
  onClose: () => void
}

export function EventDialog({
  occurrence, initialRange, collections, colRef, showCollectionPicker, readOnly, onClose,
}: Props) {
  const isNew = occurrence === null
  // The pristine snapshot: saves are diffed against it so untouched fields
  // never appear in the written edits (byte-stable round-trips).
  const [initial] = useState<FormState>(() => initialForm(occurrence, colRef, initialRange))
  const [form, setForm] = useState<FormState>(initial)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [scopeAsk, setScopeAsk] = useState<
    | null
    | { kind: 'save-scope' }
    | { kind: 'delete-scope' }
    | { kind: 'reset-warning'; edits: SeriesEdits }
  >(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const mutations = useEventMutations()
  const pending =
    mutations.create.isPending || mutations.saveSeries.isPending || mutations.saveOccurrence.isPending ||
    mutations.deleteSeries.isPending || mutations.deleteOccurrence.isPending || mutations.deleteFuture.isPending

  const names = collections.map((c) => c.ref)
  const accent = collectionColor(names, form.col)
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (scopeAsk) setScopeAsk(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, scopeAsk])

  // Auto-grow the notes field to its content.
  useEffect(() => {
    const el = descRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [form.description])

  // ── Derived values ─────────────────────────────────────────────────────────

  const startDT = parseLocal(form.startDate, form.allDay ? '00:00' : form.startTime)
  const endShownDT = parseLocal(form.endDate, form.allDay ? '00:00' : form.endTime)
  const endDT = endShownDT && form.allDay ? new Date(endShownDT.getTime() + DAY_MS) : endShownDT
  const timesValid = !!startDT && !!endDT && endDT.getTime() >= startDT.getTime() + (form.allDay ? DAY_MS : 0)
  const canSave = !readOnly && !pending && form.summary.trim().length > 0 && timesValid

  const currentRrule: string | null = form.unsupportedRrule
    ? form.unsupportedRrule
    : form.recurrence
    ? formToRrule(form.recurrence, form.allDay)
    : null

  // Compare against the *initial form's* rendering, not master.rrule: the form
  // is lossy about details like UNTIL's time-of-day, so diffing raw strings
  // would see a phantom rule change on every untouched save (and needlessly
  // reset overrides). Only a rule the user actually touched counts as changed.
  const initialRrule: string | null = initial.unsupportedRrule
    ? initial.unsupportedRrule
    : initial.recurrence
    ? formToRrule(initial.recurrence, initial.allDay)
    : null
  const ruleChanged = currentRrule !== initialRrule

  const timesChanged =
    form.allDay !== initial.allDay ||
    form.startDate !== initial.startDate ||
    form.endDate !== initial.endDate ||
    (!form.allDay && (form.startTime !== initial.startTime || form.endTime !== initial.endTime))

  const contentEdits = (): Partial<EventFields> => {
    const e: Partial<EventFields> = {}
    const i = initial
    if (form.summary !== i.summary) e.summary = form.summary.trim()
    if (form.description !== i.description) e.description = form.description.trim() || undefined
    if (form.location !== i.location) e.location = form.location.trim() || undefined
    if (form.url !== i.url) e.url = form.url.trim() || undefined
    if (form.status !== i.status) e.status = form.status || undefined
    if (form.transp !== i.transp) e.transp = form.transp === 'OPAQUE' ? undefined : form.transp
    if (form.categories.join(' ') !== i.categories.join(' ')) {
      e.categories = form.categories.length ? form.categories : undefined
    }
    if (form.reminder !== i.reminder && form.reminder !== 'custom') e.reminder = form.reminder || undefined
    return e
  }

  // ── Save / delete flows ────────────────────────────────────────────────────

  const finishSeriesSave = (edits: SeriesEdits) => {
    const master = occurrence!.master
    if (scheduleChanged(master, edits) && ((master.overrides?.length ?? 0) > 0 || (master.exdates?.length ?? 0) > 0)) {
      setScopeAsk({ kind: 'reset-warning', edits })
      return
    }
    mutations.saveSeries.mutate({ col: colRef, master, edits }, { onSuccess: onClose })
  }

  const seriesEdits = (): SeriesEdits => {
    const occ = occurrence!
    const edits: SeriesEdits = { ...contentEdits() }
    if (ruleChanged) edits.rrule = currentRrule
    if (timesChanged && startDT && endDT) {
      // Apply the occurrence-level time edit to the series as a delta shift.
      const delta = startDT.getTime() - occ.start.getTime()
      Object.assign(edits, shiftSeries(occ.master, delta, endDT.getTime() - startDT.getTime(), form.allDay))
    }
    return edits
  }

  const occurrenceEdits = (): Partial<EventFields> => ({
    ...contentEdits(),
    start: toICalString(startDT!, form.allDay),
    end: toICalString(endDT!, form.allDay),
    all_day: form.allDay || undefined,
  })

  const handleSave = () => {
    if (!canSave || !startDT || !endDT) return
    if (isNew) {
      mutations.create.mutate({
        col: form.col,
        event: {
          uid: crypto.randomUUID(),
          summary: form.summary.trim(),
          start: toICalString(startDT, form.allDay),
          end: toICalString(endDT, form.allDay),
          all_day: form.allDay || undefined,
          description: form.description.trim() || undefined,
          location: form.location.trim() || undefined,
          url: form.url.trim() || undefined,
          status: form.status || undefined,
          transp: form.transp === 'OPAQUE' ? undefined : form.transp,
          categories: form.categories.length ? form.categories : undefined,
          reminder: form.reminder && form.reminder !== 'custom' ? form.reminder : undefined,
          rrule: currentRrule ?? undefined,
        },
      }, { onSuccess: onClose })
      return
    }
    const occ = occurrence
    const edits = contentEdits()
    const instanceChanged = Object.keys(edits).length > 0 || timesChanged
    if (!ruleChanged && !instanceChanged) return onClose()

    if (!occ.isRecurring || ruleChanged) {
      // Plain events, and any rule edit, are unambiguously whole-series saves.
      finishSeriesSave(seriesEdits())
      return
    }
    setScopeAsk({ kind: 'save-scope' })
  }

  const handleScope = (scope: EditScope) => {
    const occ = occurrence!
    const ask = scopeAsk
    setScopeAsk(null)
    if (ask?.kind === 'reset-warning') {
      mutations.saveSeries.mutate({ col: colRef, master: occ.master, edits: ask.edits }, { onSuccess: onClose })
      return
    }
    if (ask?.kind === 'save-scope') {
      if (scope === 'this') {
        mutations.saveOccurrence.mutate({ col: colRef, occ, edits: occurrenceEdits() }, { onSuccess: onClose })
      } else {
        finishSeriesSave(seriesEdits())
      }
      return
    }
    if (ask?.kind === 'delete-scope') {
      if (scope === 'this') mutations.deleteOccurrence.mutate({ col: colRef, occ }, { onSuccess: onClose })
      else if (scope === 'future') mutations.deleteFuture.mutate({ col: colRef, occ }, { onSuccess: onClose })
      else mutations.deleteSeries.mutate({ col: colRef, master: occ.master }, { onSuccess: onClose })
    }
  }

  const handleDelete = () => {
    const occ = occurrence!
    if (occ.isRecurring) {
      setScopeAsk({ kind: 'delete-scope' })
    } else {
      setConfirmDelete(true)
    }
  }

  // ── Chip input ─────────────────────────────────────────────────────────────
  const [catInput, setCatInput] = useState('')
  const addCat = (v: string) => {
    const t = v.trim()
    if (t && !form.categories.includes(t)) set({ categories: [...form.categories, t] })
    setCatInput('')
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12.5, fontWeight: 600, letterSpacing: '0.07em',
    textTransform: 'uppercase', color: 'var(--muted-foreground)', marginBottom: 5,
  }

  const pill = (active: boolean): React.CSSProperties => ({
    padding: '3px 11px', borderRadius: 20, fontSize: 14, fontWeight: 500,
    cursor: readOnly ? 'default' : 'pointer', transition: 'all 80ms',
    border: `1px solid ${active ? accent.bg : 'var(--border)'}`,
    background: active ? accent.bg : 'var(--background)',
    color: active ? '#fff' : 'var(--muted-foreground)',
  })

  const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '30px 1fr', alignItems: 'start' }
  const rowIcon: React.CSSProperties = { width: 15, height: 15, color: 'var(--muted-foreground)', marginTop: 8 }

  const editableCollections = collections.filter((c) => c.ref !== 'capture' && c.myAccess !== 'read')

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`
        .evd-panel { animation: evd-in 140ms cubic-bezier(0.2, 0.8, 0.3, 1); }
        @media (prefers-reduced-motion: reduce) { .evd-panel { animation: none; } }
        @keyframes evd-in { from { opacity: 0; transform: translateY(6px) scale(0.985); } to { opacity: 1; transform: none; } }
        .evd-input {
          width: 100%; padding: 6px 9px; border-radius: 7px; border: 1px solid var(--border);
          background: var(--background); color: var(--foreground); font-size: 16px;
          font-family: inherit; outline: none; box-sizing: border-box;
          transition: border-color 90ms, box-shadow 90ms;
        }
        .evd-input:focus { border-color: ${accent.bg}; box-shadow: 0 0 0 3px ${accent.bg}22; }
        .evd-input:disabled { opacity: 0.7; }
        .evd-title {
          width: 100%; border: none; outline: none; background: transparent;
          font-family: inherit; font-size: 23px; font-weight: 650; color: var(--foreground);
          padding: 0; caret-color: ${accent.bg};
        }
        .evd-title::placeholder { color: var(--muted-foreground); opacity: 0.55; }
      `}</style>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)' }} onClick={onClose} />
      <div
        className="evd-panel"
        role="dialog"
        aria-label={isNew ? 'New event' : 'Edit event'}
        style={{
          position: 'relative', zIndex: 61, width: 560, maxWidth: 'calc(100vw - 28px)',
          maxHeight: '90vh', overflowY: 'auto',
          background: 'var(--background)', border: '1px solid var(--border)',
          borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.28)',
          padding: '18px 20px 16px',
        }}
      >
        {/* Header: collection + badges + close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {isNew && showCollectionPicker ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: accent.bg, flexShrink: 0 }} />
              <select
                value={form.col}
                onChange={(e) => set({ col: e.target.value })}
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 14.5, fontWeight: 600, color: 'var(--foreground)',
                  fontFamily: 'inherit', cursor: 'pointer', padding: 0,
                }}
              >
                {editableCollections.map((c) => (
                  <option key={c.ref} value={c.ref}>{c.display_name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: accent.bg }} />
              <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--foreground)' }}>
                {collections.find((c) => c.ref === form.col)?.display_name ?? form.col}
              </span>
            </div>
          )}
          {occurrence?.override && occurrence.isRecurring && (
            <span style={{
              fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
              padding: '2px 8px', borderRadius: 20,
              background: `${accent.bg}18`, color: accent.bg,
            }}>
              Edited occurrence
            </span>
          )}
          {readOnly && (
            <span style={{
              fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
              padding: '2px 8px', borderRadius: 20,
              background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted-foreground)',
            }}>
              View only
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, borderRadius: 6, color: 'var(--muted-foreground)', display: 'flex',
            }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Title */}
        <input
          className="evd-title"
          value={form.summary}
          onChange={(e) => set({ summary: e.target.value })}
          placeholder="Add title"
          disabled={readOnly}
          autoFocus={!readOnly}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 13, marginTop: 16 }}>
          {/* When */}
          <div style={row}>
            <Clock style={rowIcon} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <input
                  type="date" className="evd-input" style={{ width: 'auto' }}
                  value={form.startDate} disabled={readOnly}
                  onChange={(e) => {
                    // Keep the end date in step when it would fall before the start.
                    const patch: Partial<FormState> = { startDate: e.target.value }
                    if (e.target.value > form.endDate) patch.endDate = e.target.value
                    set(patch)
                  }}
                />
                {!form.allDay && (
                  <input
                    type="time" className="evd-input" style={{ width: 'auto' }}
                    value={form.startTime} disabled={readOnly}
                    onChange={(e) => set({ startTime: e.target.value })}
                  />
                )}
                <span style={{ fontSize: 14.5, color: 'var(--muted-foreground)' }}>to</span>
                {!form.allDay && (
                  <input
                    type="time" className="evd-input" style={{ width: 'auto' }}
                    value={form.endTime} disabled={readOnly}
                    onChange={(e) => set({ endTime: e.target.value })}
                  />
                )}
                <input
                  type="date" className="evd-input" style={{ width: 'auto' }}
                  value={form.endDate} disabled={readOnly}
                  onChange={(e) => set({ endDate: e.target.value })}
                />
                <button type="button" disabled={readOnly} onClick={() => set({ allDay: !form.allDay })} style={pill(form.allDay)}>
                  All day
                </button>
              </div>
              {!timesValid && (
                <span style={{ fontSize: 13.5, color: 'var(--destructive)' }}>
                  The end must not be before the start.
                </span>
              )}
            </div>
          </div>

          {/* Repeat */}
          <div style={row}>
            <Repeat style={rowIcon} />
            <RecurrenceEditor
              value={form.recurrence}
              unsupportedRule={form.unsupportedRrule}
              allDay={form.allDay}
              accent={accent.bg}
              disabled={readOnly}
              onChange={(recurrence) => set({ recurrence })}
              onReplaceUnsupported={() =>
                set({ unsupportedRrule: undefined, recurrence: { freq: 'WEEKLY', interval: 1, byweekday: [], ends: { type: 'never' } } })
              }
            />
          </div>

          {/* Reminder */}
          <div style={row}>
            <Bell style={rowIcon} />
            <select
              className="evd-input" style={{ width: 'auto', minWidth: 180 }}
              value={form.reminder} disabled={readOnly}
              onChange={(e) => set({ reminder: e.target.value })}
            >
              {REMINDERS.map((r) => (
                <option key={r.v} value={r.v}>{r.label}</option>
              ))}
              {form.reminder === 'custom' && <option value="custom" disabled>Custom (kept)</option>}
            </select>
          </div>

          {/* Location */}
          <div style={row}>
            <MapPin style={rowIcon} />
            <input
              className="evd-input" placeholder={readOnly ? undefined : 'Add location'}
              value={form.location} disabled={readOnly}
              onChange={(e) => set({ location: e.target.value })}
            />
          </div>

          {/* URL */}
          <div style={row}>
            <Link style={rowIcon} />
            <input
              type="url" className="evd-input" placeholder={readOnly ? undefined : 'https://…'}
              value={form.url} disabled={readOnly}
              onChange={(e) => set({ url: e.target.value })}
            />
          </div>

          {/* Notes */}
          <div style={row}>
            <AlignLeft style={rowIcon} />
            <textarea
              ref={descRef}
              className="evd-input" rows={2}
              style={{ resize: 'none', lineHeight: 1.5, overflowY: 'auto' }}
              placeholder={readOnly ? undefined : 'Add notes'}
              value={form.description} disabled={readOnly}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />

          {/* Status + Show as */}
          <div style={row}>
            <CheckCircle2 style={{ ...rowIcon, marginTop: 22 }} />
            <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
              <div>
                <span style={labelStyle}>Status</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {STATUSES.map((s) => (
                    <button
                      key={s.v} type="button" disabled={readOnly}
                      onClick={() => set({ status: s.v })}
                      style={pill((form.status || 'CONFIRMED') === s.v)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span style={labelStyle}>Show as</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {SHOW_AS.map((s) => (
                    <button
                      key={s.v} type="button" disabled={readOnly}
                      onClick={() => set({ transp: s.v })}
                      style={pill(form.transp === s.v)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Tags */}
          <div style={row}>
            <Tag style={rowIcon} />
            <div
              style={{
                display: 'flex', flexWrap: 'wrap', gap: 5, padding: '4px 6px',
                borderRadius: 7, border: '1px solid var(--border)',
                background: 'var(--background)', minHeight: 34, alignItems: 'center',
              }}
            >
              {form.categories.map((cat) => (
                <span
                  key={cat}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    padding: '1px 8px', borderRadius: 20,
                    background: `${accent.bg}22`, color: accent.bg,
                    fontSize: 14, fontWeight: 500,
                  }}
                >
                  {cat}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => set({ categories: form.categories.filter((c) => c !== cat) })}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', lineHeight: 1, fontSize: 16 }}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              <input
                value={catInput}
                onChange={(e) => setCatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCat(catInput) }
                  if (e.key === 'Backspace' && !catInput && form.categories.length) {
                    set({ categories: form.categories.slice(0, -1) })
                  }
                }}
                onBlur={() => catInput.trim() && addCat(catInput)}
                disabled={readOnly}
                placeholder={readOnly || form.categories.length > 0 ? '' : 'Add tags'}
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 15.5, color: 'var(--foreground)', fontFamily: 'inherit',
                  minWidth: 70, flex: 1,
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {readOnly || isNew ? (
            <span />
          ) : confirmDelete ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15.5, color: 'var(--destructive)', fontWeight: 500 }}>Delete?</span>
              <button
                type="button"
                onClick={() => mutations.deleteSeries.mutate({ col: colRef, master: occurrence.master }, { onSuccess: onClose })}
                disabled={pending}
                style={{ padding: '3px 10px', borderRadius: 7, border: 'none', background: 'var(--destructive)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                style={{ padding: '3px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', fontSize: 14, cursor: 'pointer', color: 'var(--foreground)' }}
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleDelete}
              title="Delete event"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, borderRadius: 7, color: 'var(--muted-foreground)', display: 'flex' }}
            >
              <Trash2 style={{ width: 15, height: 15 }} />
            </button>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '5px 13px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', fontSize: 15.5, cursor: 'pointer', color: 'var(--foreground)' }}
            >
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                style={{
                  padding: '5px 16px', borderRadius: 7, border: 'none',
                  background: accent.bg, color: '#fff', fontSize: 15.5, fontWeight: 600,
                  cursor: canSave ? 'pointer' : 'default', opacity: canSave ? 1 : 0.55,
                }}
              >
                Save
              </button>
            )}
          </div>
        </div>

        <ScopeDialog
          open={scopeAsk !== null}
          accent={accent.bg}
          title={
            scopeAsk?.kind === 'delete-scope' ? 'Delete recurring event'
            : scopeAsk?.kind === 'reset-warning' ? 'Change the whole series?'
            : 'Save recurring event'
          }
          warning={
            scopeAsk?.kind === 'reset-warning'
              ? 'Changing the schedule resets skipped and edited occurrences of this series.'
              : undefined
          }
          options={
            scopeAsk?.kind === 'delete-scope'
              ? [
                  { value: 'this', label: 'This event', hint: 'Only this occurrence is removed.' },
                  { value: 'future', label: 'This and future events', hint: 'The series ends before this occurrence.' },
                  { value: 'all', label: 'All events', hint: 'The entire series is deleted.' },
                ]
              : scopeAsk?.kind === 'reset-warning'
              ? [{ value: 'all', label: 'Change all events', hint: 'Skipped and edited occurrences are reset.' }]
              : [
                  { value: 'this', label: 'This event', hint: 'Only this occurrence changes.' },
                  { value: 'all', label: 'All events', hint: 'Every occurrence in the series changes.' },
                ]
          }
          onChoose={handleScope}
          onCancel={() => setScopeAsk(null)}
        />
      </div>
    </div>
  )
}
