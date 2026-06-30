export type { Collection, CalEvent, Todo, DataType } from '@/types'

export class CalDAVError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'CalDAVError'
  }
}

export interface SyncResult<T> {
  syncToken: string
  /** Items that were created or updated since the last sync. */
  changed: T[]
  /** Hrefs of deleted items. */
  deleted: string[]
}

export interface FreeBusySlot {
  start: string
  end: string
  type: 'BUSY' | 'BUSY-UNAVAILABLE' | 'BUSY-TENTATIVE' | 'FREE'
}
