import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { KeyRound, Plus, ShieldCheck, Trash2, Users as UsersIcon } from 'lucide-react'
import { caldav } from '@/api'
import { PageBar } from '@/components/layout/PageBar'
import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import type { Me, UserAccount } from '@/types'

interface NewUserForm {
  username: string
  password: string
  displayName: string
  email: string
}

const emptyNewUser = (): NewUserForm => ({ username: '', password: '', displayName: '', email: '' })

const fieldHint: React.CSSProperties = {
  fontSize: 13.5,
  color: 'var(--muted-foreground)',
  margin: '4px 0 0',
  lineHeight: 1.4,
}

function AdminChip() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding: '2px 8px',
        borderRadius: 999,
        background: 'var(--accent)',
        color: 'var(--secondary-foreground)',
        border: '1px solid var(--border)',
      }}
    >
      <ShieldCheck style={{ width: 11, height: 11 }} />
      Admin
    </span>
  )
}

function UserRow({
  user,
  me,
  onResetPassword,
  onDelete,
}: {
  user: UserAccount
  me: Me | null
  onResetPassword: () => void
  onDelete: (() => void) | null
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: hovered ? 'var(--hover-bg)' : 'transparent',
        transition: 'background 100ms',
      }}
    >
      <UserAvatar username={user.username} displayName={user.displayName} size={34} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: 'var(--foreground)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.displayName}
          </span>
          {user.isAdmin && <AdminChip />}
          {me?.username === user.username && (
            <span style={{ fontSize: 13.5, color: 'var(--ui-text-muted)' }}>you</span>
          )}
        </div>
        <p
          style={{
            fontSize: 14,
            color: 'var(--muted-foreground)',
            margin: '1px 0 0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {user.username}
          {user.email ? ` · ${user.email}` : ''}
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 120ms',
          pointerEvents: hovered ? 'auto' : 'none',
        }}
      >
        <Button variant="ghost" size="sm" onClick={onResetPassword} title="Reset password">
          <KeyRound />
          Reset password
        </Button>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            title="Delete user"
            style={{ color: 'var(--destructive)' }}
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </div>
  )
}

export function UsersPage() {
  const qc = useQueryClient()

  const { data: me = null } = useQuery({ queryKey: ['me'], queryFn: () => caldav.whoami() })

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => caldav.listUsers(),
    enabled: !!me?.isAdmin,
  })

  const [newUser, setNewUser] = useState<NewUserForm | null>(null)
  const [resetTarget, setResetTarget] = useState<UserAccount | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<UserAccount | null>(null)

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['users'] })

  const createUser = useMutation({
    mutationFn: (f: NewUserForm) =>
      caldav.createUser({
        username: f.username.trim().toLowerCase(),
        password: f.password,
        displayName: f.displayName.trim() || undefined,
        email: f.email.trim() || undefined,
      }),
    onSuccess: (u) => {
      invalidate()
      setNewUser(null)
      toast.success(`${u.displayName} can now sign in`)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const resetPass = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      caldav.updateUser(username, { password }),
    onSuccess: (u) => {
      setResetTarget(null)
      setResetPassword('')
      toast.success(`Password reset for ${u.username}`)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const removeUser = useMutation({
    mutationFn: (username: string) => caldav.deleteUser(username),
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: ['collections'] })
      setDeleteTarget(null)
      toast.success('User deleted')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  // Non-admins have no business here
  if (me && !me.isAdmin) return <Navigate to="/today" replace />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageBar
        icon={<UsersIcon style={{ width: 18, height: 18, color: 'var(--muted-foreground)' }} />}
        title="Users"
        detail={`${users.length} account${users.length === 1 ? '' : 's'}`}
        controls={
          <Button onClick={() => setNewUser(emptyNewUser())}>
            <Plus />
            New user
          </Button>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {isLoading ? (
          <p style={{ fontSize: 16, color: 'var(--ui-text-muted)' }}>Loading…</p>
        ) : (
          <div style={{ maxWidth: 680 }}>
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
                background: 'var(--card)',
                boxShadow: 'var(--surface-shadow)',
              }}
            >
              {users.map((u, i) => (
                <div key={u.username} style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                  <UserRow
                    user={u}
                    me={me}
                    onResetPassword={() => { setResetTarget(u); setResetPassword('') }}
                    onDelete={u.isAdmin ? null : () => setDeleteTarget(u)}
                  />
                </div>
              ))}
            </div>
            <p style={{ ...fieldHint, margin: '12px 2px 0' }}>
              Everyone here can sign in to this CalStakk and share calendars and task lists with
              each other. The admin account manages users and can’t be deleted.
            </p>
          </div>
        )}
      </div>

      {/* New user dialog */}
      <Dialog open={!!newUser} onOpenChange={(o) => !o && setNewUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
          </DialogHeader>
          {newUser && (
            <div className="grid gap-4" style={{ paddingTop: 4 }}>
              <div className="grid gap-2">
                <Label htmlFor="nu-username">Username</Label>
                <Input
                  id="nu-username"
                  autoFocus
                  autoCapitalize="none"
                  spellCheck={false}
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                />
                <p style={fieldHint}>Lowercase letters, digits, and . _ - — used to sign in.</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="nu-password">Password</Label>
                <Input
                  id="nu-password"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="nu-displayname">Display name</Label>
                <Input
                  id="nu-displayname"
                  value={newUser.displayName}
                  onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="nu-email">Email</Label>
                <Input
                  id="nu-email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                />
                <p style={fieldHint}>Optional — lets meeting invitations reach their inbox.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewUser(null)}>Cancel</Button>
            <Button
              onClick={() => createUser.mutate(newUser!)}
              disabled={createUser.isPending || !newUser?.username.trim() || !newUser?.password}
            >
              Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4" style={{ paddingTop: 4 }}>
            {resetTarget && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <UserAvatar username={resetTarget.username} displayName={resetTarget.displayName} size={30} />
                <div>
                  <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>
                    {resetTarget.displayName}
                  </p>
                  <p style={{ fontSize: 13.5, color: 'var(--muted-foreground)', margin: 0 }}>
                    {resetTarget.username}
                  </p>
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="rp-password">New password</Label>
              <Input
                id="rp-password"
                autoFocus
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
              />
              {resetTarget?.username === me?.username && (
                <p style={fieldHint}>This is your own account — you’ll be asked to sign in again.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button
              onClick={() => resetPass.mutate({ username: resetTarget!.username, password: resetPassword })}
              disabled={resetPass.isPending || !resetPassword}
            >
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.displayName}?</DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: 15.5, lineHeight: 1.5, color: 'var(--muted-foreground)', margin: 0 }}>
            This permanently deletes <strong style={{ color: 'var(--foreground)' }}>{deleteTarget?.username}</strong>,
            all of their calendars and tasks, and every share involving them. This can’t be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => removeUser.mutate(deleteTarget!.username)}
              disabled={removeUser.isPending}
            >
              Delete user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
