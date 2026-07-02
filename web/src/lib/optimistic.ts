/**
 * Optimistic-mutation plumbing shared by every write in the app.
 *
 * The server round-trip in production is long enough that waiting for
 * onSuccess + refetch before showing a change reads as a glitch (the UI
 * resets instantly, the data catches up seconds later). Every mutation
 * instead patches the affected query caches the moment it fires, rolls the
 * patches back (with an error toast) on failure, and re-syncs with the
 * server once the last in-flight mutation settles.
 *
 * Usage — spread into useMutation options:
 *
 *   const save = useMutation({
 *     mutationFn: (todo: Todo) => caldav.updateTodo(col, todo),
 *     ...withOptimism<Todo>(qc, {
 *       patches: (todo) => [
 *         patchList<Todo>(['todos', col], (ts) => ts.map((t) => t.uid === todo.uid ? todo : t)),
 *       ],
 *       sideEffects: () => onClose(),
 *       onSuccess: () => toast.success('Saved'),
 *     }),
 *   })
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'

export interface CachePatch {
  key: QueryKey
  update: (old: unknown) => unknown
}

/** Type-safe patch for a list cache (`Todo[]`, `CalEvent[]`, `Collection[]`, …). */
export function patchList<T>(key: QueryKey, update: (items: T[]) => T[]): CachePatch {
  return { key, update: (old) => update(old as T[]) }
}

interface OptimismCtx {
  snapshots: [QueryKey, unknown][]
}

export function withOptimism<TVars, TData = unknown>(
  qc: QueryClient,
  cfg: {
    /** Cache patches applied the moment the mutation fires. */
    patches: (vars: TVars) => CachePatch[]
    /** Synchronous UI side effects at fire time (close a dialog, reset a form). */
    sideEffects?: (vars: TVars) => void
    /** Runs on server confirmation — success toasts, navigation. */
    onSuccess?: (data: TData, vars: TVars) => void
  },
) {
  return {
    onMutate: async (vars: TVars): Promise<OptimismCtx> => {
      const patches = cfg.patches(vars)
      // Cancel in-flight fetches so a stale response can't clobber the patch.
      await Promise.all(patches.map((p) => qc.cancelQueries({ queryKey: p.key })))
      const snapshots = patches.map((p): [QueryKey, unknown] => [p.key, qc.getQueryData(p.key)])
      for (const p of patches) {
        // Only patch populated caches; an empty cache just fetches fresh.
        qc.setQueryData(p.key, (old: unknown) => (old === undefined ? undefined : p.update(old)))
      }
      cfg.sideEffects?.(vars)
      return { snapshots }
    },
    onError: (e: Error, _vars: TVars, ctx?: OptimismCtx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data)
      toast.error(e.message || String(e))
    },
    onSuccess: (data: TData, vars: TVars) => cfg.onSuccess?.(data, vars),
    onSettled: (_data: TData | undefined, _err: Error | null, _vars: TVars, ctx?: OptimismCtx) => {
      // While sibling mutations are still in flight, a refetch would briefly
      // wipe their optimistic patches — the last mutation standing re-syncs.
      if (qc.isMutating() > 1) return
      for (const [key] of ctx?.snapshots ?? []) void qc.invalidateQueries({ queryKey: key })
    },
  }
}
