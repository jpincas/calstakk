import { caldav } from './index'
import type { CalEvent, Todo } from '@/types'

export function listEvents(collection: string, from?: string, to?: string): Promise<CalEvent[]> {
  return caldav.listEvents(collection, from && to ? { from, to } : undefined)
}

export function getEvent(collection: string, uid: string): Promise<CalEvent> {
  return caldav.getEvent(collection, uid)
}

export function putEvent(
  collection: string,
  event: Partial<CalEvent> & { uid: string; summary: string; start: string },
): Promise<void> {
  return caldav.updateEvent(collection, { ...event, start: event.start })
}

export function listTodos(collection: string): Promise<Todo[]> {
  return caldav.listTodos(collection)
}

export function putTodo(
  collection: string,
  todo: Partial<Todo> & { uid: string; summary: string },
): Promise<void> {
  return caldav.updateTodo(collection, todo as Todo & { uid: string; summary: string })
}

/** Delete any calendar object by uid — works for both events and todos. */
export function deleteCalObject(collection: string, uid: string): Promise<void> {
  return caldav.deleteEvent(collection, uid)
}
