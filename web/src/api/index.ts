import { CalDAVClient } from './client'

export { CalDAVClient } from './client'
export { CalDAVError } from './types'
export type { SyncResult, FreeBusySlot } from './types'

export const caldav = new CalDAVClient()
