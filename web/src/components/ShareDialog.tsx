import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { UserPlus, X } from 'lucide-react'
import { caldav } from '@/api'
import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Me, Sharee } from '@/types'

interface Props {
  /** Collection ref (owner-side, so the plain name). */
  collectionRef: string
  collectionDisplayName: string
  accentColor: string
  me: Me | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const selectClass =
  'flex h-9 rounded-md border border-input bg-transparent px-2.5 py-1 text-sm shadow-sm'

const sectionLabel: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted-foreground)',
  margin: '0 0 8px',
}

function ShareeRow({
  sharee,
  displayName,
  busy,
  onChangeAccess,
  onRemove,
}: {
  sharee: Sharee
  displayName: string
  busy: boolean
  onChangeAccess: (access: Sharee['access']) => void
  onRemove: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 10,
        background: hovered ? 'var(--hover-bg)' : 'transparent',
        transition: 'background 100ms',
      }}
    >
      <UserAvatar username={sharee.username} displayName={displayName} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--foreground)',
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayName}
        </p>
        <p style={{ fontSize: 13, color: 'var(--muted-foreground)', margin: 0 }}>
          {sharee.username}
        </p>
      </div>
      <select
        className={selectClass}
        value={sharee.access}
        disabled={busy}
        onChange={(e) => onChangeAccess(e.target.value as Sharee['access'])}
      >
        <option value="read">Can view</option>
        <option value="read-write">Can edit</option>
      </select>
      <button
        onClick={onRemove}
        disabled={busy}
        title="Remove access"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          color: 'var(--muted-foreground)',
          cursor: 'pointer',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 120ms, color 100ms',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--destructive)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--muted-foreground)' }}
      >
        <X style={{ width: 14, height: 14 }} />
      </button>
    </div>
  )
}

export function ShareDialog({
  collectionRef,
  collectionDisplayName,
  accentColor,
  me,
  open,
  onOpenChange,
}: Props) {
  const qc = useQueryClient()
  const [pickedUser, setPickedUser] = useState('')
  const [pickedAccess, setPickedAccess] = useState<Sharee['access']>('read')

  const { data: sharees = [], isLoading } = useQuery({
    queryKey: ['sharees', collectionRef],
    queryFn: () => caldav.getSharees(collectionRef),
    enabled: open,
  })

  const { data: allUsers = [] } = useQuery({
    queryKey: ['principals'],
    queryFn: () => caldav.searchUsers(''),
    enabled: open,
    staleTime: 60_000,
  })

  const candidates = allUsers.filter(
    (u) => u.username !== me?.username && !sharees.some((s) => s.username === u.username),
  )

  const displayNameOf = (username: string) =>
    allUsers.find((u) => u.username === username)?.displayName ?? username

  const save = useMutation({
    mutationFn: (next: Sharee[]) => caldav.setSharees(collectionRef, next),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sharees', collectionRef] })
      void qc.invalidateQueries({ queryKey: ['collections'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const addSharee = () => {
    if (!pickedUser) return
    save.mutate([...sharees, { username: pickedUser, access: pickedAccess }])
    setPickedUser('')
    setPickedAccess('read')
  }

  const changeAccess = (username: string, access: Sharee['access']) => {
    save.mutate(sharees.map((s) => (s.username === username ? { ...s, access } : s)))
  }

  const removeSharee = (username: string) => {
    save.mutate(sharees.filter((s) => s.username !== username))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share “{collectionDisplayName}”</DialogTitle>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 4 }}>
          {/* Add someone */}
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                className={selectClass}
                style={{ flex: 1, minWidth: 0 }}
                value={pickedUser}
                onChange={(e) => setPickedUser(e.target.value)}
              >
                <option value="">Choose a person…</option>
                {candidates.map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.displayName} ({u.username})
                  </option>
                ))}
              </select>
              <select
                className={selectClass}
                value={pickedAccess}
                onChange={(e) => setPickedAccess(e.target.value as Sharee['access'])}
              >
                <option value="read">Can view</option>
                <option value="read-write">Can edit</option>
              </select>
              <Button
                onClick={addSharee}
                disabled={!pickedUser || save.isPending}
                style={{ background: accentColor, color: '#fff', border: 'none' }}
              >
                <UserPlus />
                Share
              </Button>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--muted-foreground)', margin: '8px 2px 0', lineHeight: 1.4 }}>
              People you share with see this project under “Shared with me”. Editors can add and
              change tasks and events; viewers can only look.
            </p>
          </div>

          {/* Current sharees */}
          <div>
            <p style={sectionLabel}>Shared with</p>
            {isLoading ? (
              <p style={{ fontSize: 15, color: 'var(--ui-text-muted)', margin: 0 }}>Loading…</p>
            ) : sharees.length === 0 ? (
              <div
                style={{
                  padding: '18px 12px',
                  borderRadius: 10,
                  border: '1px dashed var(--border)',
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: 15, color: 'var(--muted-foreground)', margin: 0 }}>
                  Only you can see this project.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {sharees.map((s) => (
                  <ShareeRow
                    key={s.username}
                    sharee={s}
                    displayName={displayNameOf(s.username)}
                    busy={save.isPending}
                    onChangeAccess={(access) => changeAccess(s.username, access)}
                    onRemove={() => removeSharee(s.username)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
