// Internal iCal parse/serialize utilities. Not part of the public API surface.

export function unescapeIcal(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/** Parse iCal text into a property map. Multi-valued properties become arrays. */
export function parseICalProps(text: string): Record<string, string | string[]> {
  const props: Record<string, string | string[]> = {}
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r\n|\n|\r/)
  for (const line of lines) {
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

export function extractComponent(ics: string, comp: string): string | null {
  const start = ics.indexOf(`BEGIN:${comp}`)
  const end = ics.indexOf(`END:${comp}`)
  if (start < 0 || end < 0) return null
  return ics.slice(start, end + `END:${comp}`.length)
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
  if (/^\d{8}T\d{6}Z?$/.test(s)) return s
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
