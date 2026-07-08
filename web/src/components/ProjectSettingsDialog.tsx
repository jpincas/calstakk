/**
 * ProjectSettingsDialog — the collection settings modal (colour + group),
 * shared by the project page's cog button and the sidebar's right-click menu.
 * Owner-only: callers must not offer it for shared collections.
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { caldav } from '@/api'
import { withOptimism, patchList } from '@/lib/optimistic'
import { displayColor, SETTING_COLORS } from '@/lib/colors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import type { Collection } from '@/types'

interface Props {
  collectionRef: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectSettingsDialog({ collectionRef, open, onOpenChange }: Props) {
  const qc = useQueryClient()

  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
  })
  const col = collections.find((c) => c.ref === collectionRef)
  const accent = displayColor(collections, collectionRef)

  const existingGroups = useMemo(() => {
    const groups = new Set<string>()
    collections.forEach((c) => { if (c.group) groups.add(c.group) })
    return Array.from(groups)
  }, [collections])

  const [settingColor, setSettingColor] = useState('')
  const [settingGroup, setSettingGroup] = useState('')

  // Re-seed the edit state from the collection on each open transition.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSettingColor(col?.color ?? accent)
      setSettingGroup(col?.group ?? '')
    }
  }

  const saveSettings = useMutation({
    mutationFn: () =>
      caldav.updateCollectionProps(collectionRef, {
        color: settingColor || undefined,
        group: settingGroup.trim() || null,
      }),
    ...withOptimism<void>(qc, {
      patches: () => [
        patchList<Collection>(['collections'], (cols) =>
          cols.map((c) =>
            c.ref === collectionRef
              ? { ...c, color: settingColor || undefined, group: settingGroup.trim() || undefined }
              : c
          )),
      ],
      sideEffects: () => onOpenChange(false),
      onSuccess: () => toast.success('Settings saved'),
    }),
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Project settings{col ? ` — ${col.display_name}` : ''}</DialogTitle>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 4 }}>
          {/* Colour section */}
          <div>
            <p
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--muted-foreground)',
                margin: '0 0 10px',
              }}
            >
              Colour
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 28px)',
                gap: 8,
              }}
            >
              {SETTING_COLORS.map((hex) => {
                const selected = settingColor.toLowerCase() === hex.toLowerCase()
                return (
                  <button
                    key={hex}
                    onClick={() => setSettingColor(selected ? '' : hex)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      border: 'none',
                      background: hex,
                      cursor: 'pointer',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      outline: selected ? `3px solid ${hex}` : 'none',
                      outlineOffset: 2,
                      boxShadow: selected ? 'inset 0 0 0 2px rgba(255,255,255,0.5)' : 'none',
                    }}
                  >
                    {selected && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        style={{ position: 'absolute' }}
                      >
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="white"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
            {!settingColor && (
              <p style={{ fontSize: 14, color: 'var(--muted-foreground)', margin: '8px 0 0' }}>
                Using palette colour. Select a swatch to override.
              </p>
            )}
          </div>

          {/* Group section */}
          <div>
            <p
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--muted-foreground)',
                margin: '0 0 10px',
              }}
            >
              Group
            </p>
            {existingGroups.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {existingGroups.map((g) => {
                  const selected = settingGroup === g
                  return (
                    <button
                      key={g}
                      onClick={() => setSettingGroup(selected ? '' : g)}
                      style={{
                        padding: '3px 10px',
                        borderRadius: 20,
                        border: '1px solid var(--border)',
                        background: selected ? accent : 'var(--accent)',
                        color: selected ? '#fff' : 'var(--foreground)',
                        fontSize: 16,
                        fontWeight: selected ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'background 100ms, color 100ms',
                      }}
                    >
                      {g}
                    </button>
                  )
                })}
              </div>
            )}
            <Input
              value={settingGroup}
              onChange={(e) => setSettingGroup(e.target.value)}
              placeholder="Group name — leave empty to remove"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => saveSettings.mutate()}
            disabled={saveSettings.isPending}
            style={{ background: accent, color: '#fff', border: 'none' }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
