import { useEffect, useRef, useState } from 'react'
import { format, isValid, parse } from 'date-fns'
import { Calendar, ChevronDown } from 'lucide-react'

/**
 * Date field that always displays dd/MM/yyyy regardless of browser locale
 * (native date inputs render in the browser's locale, i.e. US format on many
 * machines). Typing accepts d/m/yyyy, d-m-yyyy, d.m.yy…; the calendar button
 * opens the native picker. Value protocol is the same as a native date
 * input: yyyy-MM-dd, '' = unset.
 */
interface Props {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Applied to the text input (e.g. the dialog's input class). */
  className?: string
  /** Applied to the text input. */
  style?: React.CSSProperties
  /** Applied to the wrapper — set width here for full-width layouts. */
  wrapperStyle?: React.CSSProperties
}

const toDisplay = (value: string): string => {
  if (!value) return ''
  const d = parse(value, 'yyyy-MM-dd', new Date())
  return isValid(d) ? format(d, 'dd/MM/yyyy') : ''
}

function parseDisplay(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  const year = y.length === 2 ? 2000 + Number(y) : Number(y)
  const date = new Date(year, Number(mo) - 1, Number(d))
  const roundTrips =
    date.getFullYear() === year && date.getMonth() === Number(mo) - 1 && date.getDate() === Number(d)
  return roundTrips ? format(date, 'yyyy-MM-dd') : null
}

export function DateInput({ value, onChange, disabled, className, style, wrapperStyle }: Props) {
  const [text, setText] = useState(() => toDisplay(value))
  const focused = useRef(false)
  const pickerRef = useRef<HTMLInputElement>(null)

  // Reflect external value changes while the field isn't being edited.
  useEffect(() => {
    if (!focused.current) setText(toDisplay(value))
  }, [value])

  const commit = () => {
    if (!text.trim()) {
      if (value) onChange('')
      setText('')
      return
    }
    const parsed = parseDisplay(text)
    if (parsed) {
      onChange(parsed)
      setText(toDisplay(parsed))
    } else {
      setText(toDisplay(value)) // invalid input reverts
    }
  }

  const openPicker = () => {
    const el = pickerRef.current
    if (!el) return
    try {
      el.showPicker()
    } catch {
      el.focus()
    }
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...wrapperStyle }}>
      <input
        type="text"
        inputMode="numeric"
        className={className}
        placeholder="dd/mm/yyyy"
        value={text}
        disabled={disabled}
        onFocus={() => { focused.current = true }}
        onBlur={() => { focused.current = false; commit() }}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
        onChange={(e) => setText(e.target.value)}
        style={{ width: 142, ...style, paddingRight: 30 }}
      />
      {!disabled && (
        <button
          type="button"
          onClick={openPicker}
          tabIndex={-1}
          aria-label="Open date picker"
          style={{
            position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
            display: 'flex', padding: 2, background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--muted-foreground)',
          }}
        >
          <Calendar style={{ width: 14, height: 14 }} />
        </button>
      )}
      {/* Invisible native input: only its picker UI is used (anchored here). */}
      <input
        ref={pickerRef}
        type="date"
        value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''}
        onChange={(e) => { onChange(e.target.value); setText(toDisplay(e.target.value)) }}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        style={{
          position: 'absolute', right: 0, bottom: 0, width: 1, height: 1,
          opacity: 0, pointerEvents: 'none', border: 'none', padding: 0,
        }}
      />
    </span>
  )
}

/**
 * Time field that always displays 24-hour HH:mm regardless of browser locale
 * (native time inputs show AM/PM on US-locale browsers). Accepts 9, 9:30,
 * 21.15, 0930…; invalid input reverts. Value protocol: HH:mm, '' = unset.
 */
interface TimeProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}

function parseTime(text: string): string | null {
  const t = text.trim()
  const m =
    t.match(/^(\d{1,2})[:.h](\d{1,2})$/) ??
    t.match(/^(\d{1,2})(\d{2})$/) ??
    t.match(/^(\d{1,2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// 96 times, "00:00"..."23:45", 15-min step.
const TIME_OPTIONS: string[] = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4)
  const min = (i % 4) * 15
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
})

export function TimeInput({ value, onChange, disabled, className, style }: TimeProps) {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const focused = useRef(false)
  const containerRef = useRef<HTMLSpanElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])

  const commit = () => {
    const parsed = parseTime(text)
    if (parsed) {
      onChange(parsed)
      setText(parsed)
    } else {
      setText(value) // invalid input reverts
    }
  }

  const scrollHighlightIntoView = (index: number) => {
    optionRefs.current[index]?.scrollIntoView({ block: 'nearest' })
  }

  const openPopover = () => {
    if (disabled) return
    const idx = Math.max(0, TIME_OPTIONS.indexOf(value))
    setHighlight(idx)
    setOpen(true)
    // Defer scroll until the popover has rendered.
    requestAnimationFrame(() => scrollHighlightIntoView(idx))
  }

  const selectTime = (time: string) => {
    onChange(time)
    setText(time)
    setOpen(false)
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'Enter') commit()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => {
        const next = Math.min(TIME_OPTIONS.length - 1, h + 1)
        scrollHighlightIntoView(next)
        return next
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => {
        const next = Math.max(0, h - 1)
        scrollHighlightIntoView(next)
        return next
      })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      selectTime(TIME_OPTIONS[highlight])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <span
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onBlur={(e) => {
        // Close only once focus has left the whole widget (input + popover).
        if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <input
        type="text"
        inputMode="numeric"
        className={className}
        placeholder="hh:mm"
        value={text}
        disabled={disabled}
        onFocus={() => { focused.current = true }}
        onBlur={() => { focused.current = false; commit() }}
        onKeyDown={handleInputKeyDown}
        onChange={(e) => setText(e.target.value)}
        style={{ width: 74, ...style, paddingRight: 22 }}
      />
      {!disabled && (
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openPopover())}
          tabIndex={-1}
          aria-label="Select a time"
          style={{
            position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
            display: 'flex', padding: 2, background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--muted-foreground)',
          }}
        >
          <ChevronDown style={{ width: 14, height: 14 }} />
        </button>
      )}
      {open && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4,
            width: 90, maxHeight: 260, overflowY: 'auto',
            borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--popover)', boxShadow: 'var(--surface-shadow-md)',
            zIndex: 60, padding: 4,
          }}
        >
          {TIME_OPTIONS.map((time, i) => (
            <button
              key={time}
              ref={(el) => { optionRefs.current[i] = el }}
              type="button"
              role="option"
              aria-selected={time === value}
              tabIndex={-1}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => selectTime(time)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '4px 8px', borderRadius: 6, border: 'none',
                background: i === highlight ? 'var(--hover-bg)' : 'transparent',
                color: time === value ? 'var(--foreground)' : 'var(--muted-foreground)',
                fontWeight: time === value ? 600 : 400,
                cursor: 'pointer', fontSize: 13,
              }}
            >
              {time}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
