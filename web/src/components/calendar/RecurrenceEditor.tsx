import { formToRrule, rruleSummary, type RecurrenceForm } from '@/lib/recur'

interface Props {
  /** null = doesn't repeat. */
  value: RecurrenceForm | null
  /** The master's rule when it can't be expressed by the form — shown read-only. */
  unsupportedRule?: string
  allDay: boolean
  accent: string
  disabled?: boolean
  onChange: (v: RecurrenceForm | null) => void
  /** Replace an unsupported foreign rule with an editable one. */
  onReplaceUnsupported: () => void
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEKDAY_TITLES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const FREQ_UNITS: Record<RecurrenceForm['freq'], [string, string]> = {
  DAILY: ['day', 'days'],
  WEEKLY: ['week', 'weeks'],
  MONTHLY: ['month', 'months'],
  YEARLY: ['year', 'years'],
}

const selectStyle: React.CSSProperties = {
  padding: '6px 8px', borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--background)', color: 'var(--foreground)',
  fontSize: 15.5, fontFamily: 'inherit', outline: 'none',
}

const numStyle: React.CSSProperties = { ...selectStyle, width: 64 }

/** True when the rule is a bare "every day/week/month/year" a preset can express. */
function isPreset(f: RecurrenceForm): boolean {
  return f.interval === 1 && f.byweekday.length === 0 && f.ends.type === 'never'
}

export function RecurrenceEditor({ value, unsupportedRule, allDay, accent, disabled, onChange, onReplaceUnsupported }: Props) {
  if (unsupportedRule) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ fontSize: 15.5, color: 'var(--foreground)' }}>
          Repeats {rruleSummary(unsupportedRule).replace(/^every/i, 'every')}
          <span style={{ color: 'var(--muted-foreground)' }}> — custom rule from another app</span>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={onReplaceUnsupported}
            style={{
              alignSelf: 'flex-start', padding: '3px 10px', borderRadius: 7,
              border: '1px solid var(--border)', background: 'none',
              fontSize: 14, cursor: 'pointer', color: 'var(--muted-foreground)',
            }}
          >
            Replace rule
          </button>
        )}
      </div>
    )
  }

  const preset = value === null ? 'none' : isPreset(value) ? value.freq.toLowerCase() : 'custom'

  const setPreset = (p: string) => {
    if (p === 'none') return onChange(null)
    if (p === 'custom') {
      return onChange(value ?? { freq: 'WEEKLY', interval: 1, byweekday: [], ends: { type: 'never' } })
    }
    onChange({ freq: p.toUpperCase() as RecurrenceForm['freq'], interval: 1, byweekday: [], ends: { type: 'never' } })
  }

  const showCustom = preset === 'custom'
  const summary = value ? rruleSummary(formToRrule(value, allDay)) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select
        value={preset}
        disabled={disabled}
        onChange={(e) => setPreset(e.target.value)}
        style={selectStyle}
      >
        <option value="none">Doesn't repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
        <option value="custom">Custom…</option>
      </select>

      {showCustom && value && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 9,
            padding: '10px 11px', borderRadius: 9,
            border: '1px solid var(--border)', background: 'var(--card)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15.5, color: 'var(--foreground)' }}>
            Every
            <input
              type="number"
              min={1}
              max={999}
              value={value.interval}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, interval: Math.max(1, +e.target.value || 1) })}
              style={numStyle}
            />
            <select
              value={value.freq}
              disabled={disabled}
              onChange={(e) => {
                const freq = e.target.value as RecurrenceForm['freq']
                onChange({ ...value, freq, byweekday: freq === 'WEEKLY' ? value.byweekday : [] })
              }}
              style={selectStyle}
            >
              {(Object.keys(FREQ_UNITS) as RecurrenceForm['freq'][]).map((f) => (
                <option key={f} value={f}>{FREQ_UNITS[f][value.interval > 1 ? 1 : 0]}</option>
              ))}
            </select>
          </div>

          {value.freq === 'WEEKLY' && (
            <div style={{ display: 'flex', gap: 5 }}>
              {WEEKDAYS.map((d, i) => {
                const on = value.byweekday.includes(i)
                return (
                  <button
                    key={i}
                    type="button"
                    title={WEEKDAY_TITLES[i]}
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        ...value,
                        byweekday: on
                          ? value.byweekday.filter((x) => x !== i)
                          : [...value.byweekday, i].sort((a, b) => a - b),
                      })
                    }
                    style={{
                      width: 28, height: 28, borderRadius: '50%',
                      border: `1px solid ${on ? accent : 'var(--border)'}`,
                      background: on ? accent : 'var(--background)',
                      color: on ? '#fff' : 'var(--muted-foreground)',
                      fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
                      transition: 'all 80ms',
                    }}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15.5, color: 'var(--foreground)', flexWrap: 'wrap' }}>
            Ends
            <select
              value={value.ends.type}
              disabled={disabled}
              onChange={(e) => {
                const t = e.target.value
                onChange({
                  ...value,
                  ends: t === 'never'
                    ? { type: 'never' }
                    : t === 'until'
                    ? { type: 'until', date: value.ends.type === 'until' ? value.ends.date : '' }
                    : { type: 'count', n: value.ends.type === 'count' ? value.ends.n : 10 },
                })
              }}
              style={selectStyle}
            >
              <option value="never">never</option>
              <option value="until">on date</option>
              <option value="count">after</option>
            </select>
            {value.ends.type === 'until' && (
              <input
                type="date"
                value={value.ends.date}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, ends: { type: 'until', date: e.target.value } })}
                style={selectStyle}
              />
            )}
            {value.ends.type === 'count' && (
              <>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={value.ends.n}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...value, ends: { type: 'count', n: Math.max(1, +e.target.value || 1) } })}
                  style={numStyle}
                />
                times
              </>
            )}
          </div>
        </div>
      )}

      {summary && (
        <div style={{ fontSize: 14, color: accent, fontWeight: 500 }}>
          Repeats {summary}
        </div>
      )}
    </div>
  )
}
