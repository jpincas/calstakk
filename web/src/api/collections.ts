import { caldav } from './index'
import type { Collection } from '@/types'

export function listCollections(): Promise<Collection[]> {
  return caldav.listCollections()
}
