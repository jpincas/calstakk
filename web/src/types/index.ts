export interface Collection {
  name: string
  display_name: string
  href: string
  color?: string
  description?: string
  order?: number
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
  href: string
}

export type DataType = 'calendar' | 'todos'
