import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { caldav } from '@/api'
import { withOptimism, patchList } from '@/lib/optimistic'
import { SETTING_COLORS } from '@/lib/colors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { Collection } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || crypto.randomUUID().slice(0, 8)
}

function uniqueSlug(name: string, existing: string[]): string {
  const base = slugify(name)
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export function NewCollectionDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [color, setColor] = useState('')

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => caldav.listCollections(),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: (slug: string) =>
      caldav.createCollection(slug, { displayName: name.trim(), color: color || undefined }),
    ...withOptimism<string>(qc, {
      patches: (slug) => [
        patchList<Collection>(['collections'], (cols) => [
          ...cols,
          {
            name: slug,
            ref: slug,
            display_name: name.trim(),
            href: '',
            owner: '',
            shared: false,
            myAccess: 'owner' as const,
            color: color || undefined,
          },
        ]),
      ],
      sideEffects: () => {
        setName('')
        setColor('')
        onOpenChange(false)
      },
      // Navigate only once the collection exists — the project page's
      // todos/events/sections queries 404 against a not-yet-created collection.
      onSuccess: (_data, slug) => {
        toast.success('List created')
        void navigate(`/${slug}`)
      },
    }),
  })

  const submit = () => create.mutate(uniqueSlug(name, collections.map((c: Collection) => c.ref)))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 4 }}>
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="e.g. Groceries"
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) submit() }}
            />
          </div>

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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 28px)', gap: 8 }}>
              {SETTING_COLORS.map((hex) => {
                const selected = color === hex
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setColor(selected ? '' : hex)}
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
                      <svg width="12" height="12" viewBox="0 0 12 12" style={{ position: 'absolute' }}>
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
            {!color && (
              <p style={{ fontSize: 14, color: 'var(--muted-foreground)', margin: '8px 0 0' }}>
                Using palette colour. Select a swatch to override.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!name.trim() || create.isPending}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
