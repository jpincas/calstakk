// Internal iCal parse/serialize utilities. Not part of the public API surface.

/** Decode RFC 5545 §3.3.11 TEXT escapes in a single pass. */
export function unescapeIcal(s: string): string {
  return s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** Encode a string as RFC 5545 §3.3.11 TEXT (backslash, semicolon, comma, newline). */
export function escapeIcal(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Unfold continuation lines and split into non-empty logical lines. */
export function unfoldLines(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '')
    .split(/\r\n|\n|\r/)
    .filter((l) => l.length > 0)
}

/** Parse iCal text into a property map. Multi-valued properties become arrays. */
export function parseICalProps(text: string): Record<string, string | string[]> {
  const props: Record<string, string | string[]> = {}
  for (const line of unfoldLines(text)) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).split(';')[0].toUpperCase()
    const val = unescapeIcal(line.slice(colon + 1))
    const existing = props[key]
    if (existing === undefined) props[key] = val
    else if (Array.isArray(existing)) existing.push(val)
    else props[key] = [existing, val]
  }
  return props
}

export function first(v: string | string[] | undefined): string | undefined {
  return v === undefined ? undefined : Array.isArray(v) ? v[0] : v
}

export function all(v: string | string[] | undefined): string[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

/** A single content line split into name / raw params / raw (still-escaped) value. */
export interface ParsedProp {
  name: string
  /** Raw parameter text between name and colon, including the leading ';' ('' if none). */
  params: string
  /** Raw value — TEXT escapes NOT decoded (callers decode per property type). */
  value: string
  /** The whole unfolded line, verbatim. */
  raw: string
}

/**
 * Find the value-separating colon of a content line, respecting double-quoted
 * parameter values (e.g. TZID="A:B"). Returns -1 when the line has no colon.
 */
function valueColon(line: string): number {
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuote = !inQuote
    else if (ch === ':' && !inQuote) return i
  }
  return -1
}

/** The raw value part of a single unfolded content line ('' when malformed). */
export function lineValue(line: string): string {
  const colon = valueColon(line)
  return colon < 0 ? '' : line.slice(colon + 1)
}

/** The raw parameter part of a content line, including the leading ';' ('' if none). */
export function lineParams(line: string): string {
  const colon = valueColon(line)
  if (colon < 0) return ''
  const semi = line.indexOf(';')
  return semi >= 0 && semi < colon ? line.slice(semi, colon) : ''
}

/** Param-aware property parser for pre-unfolded top-level lines. */
export function parseComponentProps(propLines: string[]): ParsedProp[] {
  const out: ParsedProp[] = []
  for (const line of propLines) {
    const colon = valueColon(line)
    if (colon < 0) continue
    const semi = line.indexOf(';')
    const nameEnd = semi >= 0 && semi < colon ? semi : colon
    out.push({
      name: line.slice(0, nameEnd).toUpperCase(),
      params: line.slice(nameEnd, colon),
      value: line.slice(colon + 1),
      raw: line,
    })
  }
  return out
}

export function propFirst(props: ParsedProp[], name: string): ParsedProp | undefined {
  return props.find((p) => p.name === name)
}

export function propAll(props: ParsedProp[], name: string): ParsedProp[] {
  return props.filter((p) => p.name === name)
}

/** Extract every top-level `comp` component block (including BEGIN/END lines). */
export function extractComponents(ics: string, comp: string): string[] {
  const blocks: string[] = []
  const begin = `BEGIN:${comp}`
  const end = `END:${comp}`
  let pos = 0
  for (;;) {
    const start = ics.indexOf(begin, pos)
    if (start < 0) break
    const stop = ics.indexOf(end, start)
    if (stop < 0) break
    blocks.push(ics.slice(start, stop + end.length))
    pos = stop + end.length
  }
  return blocks
}

export function extractComponent(ics: string, comp: string): string | null {
  return extractComponents(ics, comp)[0] ?? null
}

/**
 * Split a component block (with its BEGIN/END wrapper) into top-level property
 * lines and raw nested sub-component blocks keyed by name — so e.g. a VALARM's
 * TRIGGER/DESCRIPTION never leak into the parent's properties.
 */
export function splitSubComponents(block: string): { propLines: string[]; sub: Record<string, string[]> } {
  const lines = unfoldLines(block)
  let from = 0
  let to = lines.length
  if (lines[0]?.toUpperCase().startsWith('BEGIN:')) {
    from = 1
    if (lines[lines.length - 1]?.toUpperCase().startsWith('END:')) to = lines.length - 1
  }
  const propLines: string[] = []
  const sub: Record<string, string[]> = {}
  let nested: string[] | null = null
  let nestedName = ''
  let depth = 0
  for (let i = from; i < to; i++) {
    const line = lines[i]
    const upper = line.toUpperCase()
    if (nested) {
      nested.push(line)
      if (upper === `BEGIN:${nestedName}`) depth++
      else if (upper === `END:${nestedName}`) {
        depth--
        if (depth === 0) {
          ;(sub[nestedName] ??= []).push(nested.join('\n'))
          nested = null
        }
      }
      continue
    }
    if (upper.startsWith('BEGIN:')) {
      nestedName = upper.slice('BEGIN:'.length)
      nested = [line]
      depth = 1
      continue
    }
    propLines.push(line)
  }
  return { propLines, sub }
}

/** Fold a single iCal line at 75-octet boundaries per RFC 5545 §3.1. */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let pos = 0
  while (pos < bytes.length) {
    const limit = pos === 0 ? 75 : 74
    parts.push(new TextDecoder().decode(bytes.slice(pos, pos + limit)))
    pos += limit
  }
  return parts.join('\r\n ')
}

/** Strip an ISO/iCal datetime to bare digits+T for use in XML time-range attributes. */
export function stripToICalBase(iso: string): string {
  return iso.replace(/[-:]/g, '').split('.')[0].replace(/Z$/, '')
}

/** Convert any datetime string to iCal compact format, preserving UTC/floating semantics. */
export function toICalDateTime(s: string): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (/^\d{8}(T\d{6}Z?)?$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '')
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)
  if (hasOffset) {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  }
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * Serialize a date/datetime property line. When `raw` (the original line, with
 * params) is given and its value still matches, the original is re-emitted so
 * TZID/VALUE params survive an untouched round-trip. An edited value is written
 * canonically: `;VALUE=DATE` for all-day, compact (UTC/floating) otherwise.
 */
export function dtLine(name: string, value: string, allDay: boolean, raw?: string): string {
  if (raw && lineValue(raw) === value) return raw
  const v = toICalDateTime(value)
  return allDay ? `${name};VALUE=DATE:${v.slice(0, 8)}` : `${name}:${v}`
}

/** Wrap component lines in a minimal valid VCALENDAR, with line folding applied. */
export function buildVCalendar(componentLines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalStakk//Web//EN',
    ...componentLines,
    'END:VCALENDAR',
  ].map(foldLine).join('\r\n')
}

export function nowIcal(): string {
  return stripToICalBase(new Date().toISOString()) + 'Z'
}
