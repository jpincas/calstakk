import { format, formatDistanceToNow, isSameWeek, isToday, isYesterday } from 'date-fns'

/** Parse iCal date strings: YYYYMMDD, YYYYMMDDTHHmmss, YYYYMMDDTHHmmssZ, or ISO */
export function parseCalDate(s: string): Date | null {
  if (!s) return null
  s = s.trim()
  if (s.includes('-')) { const d = new Date(s); return isNaN(d.getTime()) ? null : d }
  if (s.length === 8) { const d = new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8)); return isNaN(d.getTime()) ? null : d }
  if (s.length >= 15 && s[8] === 'T') {
    const Y=+s.slice(0,4), M=+s.slice(4,6)-1, D=+s.slice(6,8), h=+s.slice(9,11), m=+s.slice(11,13), sec=+s.slice(13,15)
    const d = s.endsWith('Z') ? new Date(Date.UTC(Y,M,D,h,m,sec)) : new Date(Y,M,D,h,m,sec)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

/** "15 May 2026" */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  try {
    const date = typeof d === 'string' ? (parseCalDate(d) ?? new Date(d)) : d
    if (!date || isNaN(date.getTime())) return '—'
    return format(date, 'd MMM yyyy')
  } catch { return '—' }
}

/** "15 May" */
export function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return '—'
  try {
    const date = typeof d === 'string' ? (parseCalDate(d) ?? new Date(d)) : d
    if (!date || isNaN(date.getTime())) return '—'
    return format(date, 'd MMM')
  } catch { return '—' }
}

/** "15 May 2026, 14:30" */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—'
  try {
    const date = typeof d === 'string' ? (parseCalDate(d) ?? new Date(d)) : d
    if (!date || isNaN(date.getTime())) return '—'
    return format(date, 'd MMM yyyy, HH:mm')
  } catch { return '—' }
}

/** "15/05/2026" */
export function fmtDateNumeric(d: Date | string | null | undefined): string {
  if (!d) return '—'
  try {
    const date = typeof d === 'string' ? (parseCalDate(d) ?? new Date(d)) : d
    if (!date || isNaN(date.getTime())) return '—'
    return format(date, 'dd/MM/yyyy')
  } catch { return '—' }
}

/** "Today", "Yesterday", or "15 May 2026" */
export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return '—'
  try {
    const date = typeof d === 'string' ? (parseCalDate(d) ?? new Date(d)) : d
    if (!date || isNaN(date.getTime())) return '—'
    if (isToday(date)) return 'Today'
    if (isYesterday(date)) return 'Yesterday'
    return fmtDate(date)
  } catch { return '—' }
}

/** "14:30" */
export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return ''
  try {
    const date = typeof d === 'string' ? (parseCalDate(d) ?? new Date(d)) : d
    if (!date || isNaN(date.getTime())) return ''
    return format(date, 'HH:mm')
  } catch { return '' }
}

/** "May 2026" */
export function fmtMonthYear(d: Date): string {
  return format(d, 'MMMM yyyy')
}

/** "2 hours ago" / "3 days ago" */
export function fmtAgo(d: Date | string | null | undefined): string {
  if (!d) return ''
  try {
    const date = typeof d === 'string' ? (parseCalDate(d) ?? new Date(d)) : d
    if (!date || isNaN(date.getTime())) return ''
    return formatDistanceToNow(date, { addSuffix: true })
  } catch { return '' }
}

/**
 * Calendar route for jumping to an event: today opens the day view, this
 * week the week view, anything else the month view — always at the event's
 * date. Weeks start Monday, matching the event bucketing.
 */
export function calendarLinkFor(start: Date): string {
  const view = isToday(start)
    ? 'day'
    : isSameWeek(start, new Date(), { weekStartsOn: 1 })
    ? 'week'
    : 'month'
  return `/calendar?date=${format(start, 'yyyy-MM-dd')}&view=${view}`
}

export function isOverdue(due: string | undefined): boolean {
  if (!due) return false
  const d = parseCalDate(due)
  if (!d) return false
  return d < new Date() && !isToday(d)
}
