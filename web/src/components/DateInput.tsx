import { useEffect, useRef, useState } from 'react'
import { format, isValid, parse } from 'date-fns'
import { Calendar } from 'lucide-react'

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

export function TimeInput({ value, onChange, disabled, className, style }: TimeProps) {
  const [text, setText] = useState(value)
  const focused = useRef(false)

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

  return (
    <input
      type="text"
      inputMode="numeric"
      className={className}
      placeholder="hh:mm"
      value={text}
      disabled={disabled}
      onFocus={() => { focused.current = true }}
      onBlur={() => { focused.current = false; commit() }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
      onChange={(e) => setText(e.target.value)}
      style={{ width: 74, ...style }}
    />
  )
}
