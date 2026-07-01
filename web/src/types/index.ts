export interface Collection {
  name: string
  display_name: string
  href: string
  color?: string
  description?: string
  order?: number
  group?: string
}

export interface CalEvent {
  uid: string
  summary: string
  description?: string
  start: string
  end?: string
  duration?: string
  all_day?: boolean
  location?: string
  status?: string
  rrule?: string
  recurrence_id?: string
  href: string
}

export interface Todo {
  uid: string
  summary: string
  description?: string
  due?: string
  status?: string
  priority?: number
  related_to?: string
  categories?: string[]
  url?: string
  x_sort_order?: number
  section_id?: string
  href: string
}

/** A named group of tasks within a collection. Persisted as X-SECTION-ID on each VTODO. */
export interface Section {
  id: string
  name: string
}

export type DataType = 'calendar' | 'todos'
export type ViewMode = 'inbox' | 'today' | 'tasks' | 'calendar'
