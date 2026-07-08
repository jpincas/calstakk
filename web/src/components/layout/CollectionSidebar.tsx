import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Crosshair, User, Moon, Sun, Inbox, CalendarDays, ListTodo, Users, LogOut, Plus, Hourglass, Tag, Settings, Link2, LayoutDashboard } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { toast } from 'sonner'
import type { Collection, Me, ViewMode } from '@/types'
import { useCollectionStore } from '@/state/collection'
import { clearSession, hasSession } from '@/state/auth'
import { collectionColor } from '@/lib/colors'
import { UserAvatar } from '@/components/UserAvatar'
import { NewCollectionDialog } from '@/components/NewCollectionDialog'
import { ProjectSettingsDialog } from '@/components/ProjectSettingsDialog'
import { useGlobalTodos } from '@/components/todos/useGlobalTodos'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
} from '@/components/ui/context-menu'

interface Props {
  collections: Collection[]
  me: Me | null
}

type NavItem = {
  mode: ViewMode
  icon: React.FC<{ style?: React.CSSProperties; strokeWidth?: number }>
  label: string
  path: string
  color: string
}

const NAV_ITEMS: NavItem[] = [
  { mode: 'home',     icon: LayoutDashboard, label: 'Home',  path: '/home',     color: '#F43F5E' },
  { mode: 'inbox',    icon: Inbox,        label: 'Inbox',    path: '/inbox',    color: '#3B82F6' },
  { mode: 'today',    icon: Sun,          label: 'Today',    path: '/today',    color: '#F59E0B' },
  { mode: 'tasks',    icon: ListTodo,     label: 'Tasks',    path: '/tasks',    color: '#10B981' },
  { mode: 'waiting',  icon: Hourglass,    label: 'Waiting',  path: '/waiting',  color: '#8B5CF6' },
  { mode: 'calendar', icon: CalendarDays, label: 'Calendar', path: '/calendar', color: '#6366F1' },
]

interface CollectionRowProps {
  col: Collection
  dotColor: string
  isActive: boolean
  isHidden: boolean
  isFocused: boolean
  isCalendarMode: boolean
  onRowClick: () => void
  onFocus: () => void
  onToggleHidden: () => void
}

function CollectionRow({
  col, dotColor, isActive, isHidden, isFocused, isCalendarMode, onRowClick, onFocus, onToggleHidden,
}: CollectionRowProps) {
  const readOnly = col.myAccess === 'read'
  const { setNodeRef, isOver } = useDroppable({
    id: `collection:${col.ref}`,
    data: { type: 'collection', name: col.ref, readOnly },
    disabled: readOnly,
  })

  return (
    <div
      ref={setNodeRef}
      className="sidebar-row"
      data-active={isActive}
      onClick={onRowClick}
      style={{
        opacity: isCalendarMode && isHidden && !isFocused ? 0.4 : 1,
        outline: isOver ? '2px solid var(--sidebar-primary)' : 'none',
        outlineOffset: -2,
        background: isOver ? 'var(--sidebar-accent)' : undefined,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
          boxShadow: isFocused ? `0 0 0 2px ${dotColor}44` : 'none',
          transition: 'box-shadow 150ms',
        }}
      />

      <span
        style={{
          fontSize: 17,
          fontWeight: 500,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: isActive ? 'var(--sidebar-primary)' : 'inherit',
        }}
      >
        {col.display_name}
      </span>

      {readOnly && (
        <Eye
          style={{ width: 12, height: 12, flexShrink: 0, color: 'var(--ui-text-muted)' }}
          aria-label="Read-only"
        />
      )}

      {isCalendarMode && (
        <div
          className="sidebar-row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="sidebar-row-icon-btn"
            data-active={isFocused}
            title={isFocused ? 'Unfocus' : 'Focus only this'}
            onClick={onFocus}
          >
            <Crosshair style={{ width: 12, height: 12 }} />
          </button>
          <button
            className="sidebar-row-icon-btn"
            data-active={isHidden}
            title={isHidden ? 'Show in calendar' : 'Hide from calendar'}
            onClick={onToggleHidden}
          >
            {isHidden
              ? <EyeOff style={{ width: 12, height: 12 }} />
              : <Eye style={{ width: 12, height: 12 }} />}
          </button>
        </div>
      )}
    </div>
  )
}

export function CollectionSidebar({ collections, me }: Props) {
  const {
    activeCollection, hiddenCollections, focusedCollection, theme,
    setCollection, setViewMode, toggleCollectionHidden, setFocusedCollection, toggleTheme,
  } = useCollectionStore()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const [newListOpen, setNewListOpen] = useState(false)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [urlFor, setUrlFor] = useState<Collection | null>(null)
  const names = collections.map((c) => c.ref)
  const { tags, waiting } = useGlobalTodos()

  const isCalendarMode = location.pathname.startsWith('/calendar')
  const visible = collections.filter((c) => c.ref !== 'capture')

  const activeMode = NAV_ITEMS.find((item) =>
    location.pathname.startsWith(item.path)
  )?.mode ?? null

  const goNav = (item: NavItem) => {
    setViewMode(item.mode)
    void navigate(item.path)
  }

  const handleRowClick = (col: Collection) => {
    setCollection(col.ref)
    void navigate(`/${col.ref}`)
  }

  const logout = () => {
    clearSession()
    qc.clear()
    void navigate('/login')
  }

  // Build grouped structure: ungrouped first, then each group alphabetically.
  // Collections shared by other users always live under "Shared with me".
  const own = visible.filter((c) => !c.shared)
  const sharedWithMe = visible.filter((c) => c.shared)
  const ungrouped = own.filter((c) => !c.group)
  const groupMap = new Map<string, Collection[]>()
  for (const col of own.filter((c) => c.group)) {
    const g = col.group!
    if (!groupMap.has(g)) groupMap.set(g, [])
    groupMap.get(g)!.push(col)
  }
  const sortedGroups = [...groupMap.keys()].sort()

  const renderRow = (col: Collection) => {
    const color = collectionColor(names, col.ref)
    const row = (
      <CollectionRow
        col={col}
        dotColor={col.color ?? color.bg}
        isActive={activeCollection === col.ref}
        isHidden={hiddenCollections.includes(col.ref)}
        isFocused={focusedCollection === col.ref}
        isCalendarMode={isCalendarMode}
        onRowClick={() => handleRowClick(col)}
        onFocus={() => setFocusedCollection(col.ref)}
        onToggleHidden={() => toggleCollectionHidden(col.ref)}
      />
    )
    return (
      <ContextMenu key={col.ref}>
        <ContextMenuTrigger style={{ display: 'block' }}>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          {col.myAccess === 'owner' && (
            <ContextMenuItem onSelect={() => setSettingsFor(col.ref)}>
              <Settings style={{ width: 13, height: 13, flexShrink: 0, opacity: 0.7 }} />
              Settings…
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => setUrlFor(col)}>
            <Link2 style={{ width: 13, height: 13, flexShrink: 0, opacity: 0.7 }} />
            CalDAV URL…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <aside
      className="flex flex-col h-full select-none"
      style={{
        width: 'var(--app-sidebar-width)',
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--sidebar-border)',
        flexShrink: 0,
      }}
    >
      {/* Top-level nav items */}
      <nav style={{ padding: '12px 8px 8px' }}>
        <div className="flex flex-col" style={{ gap: 1 }}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = activeMode === item.mode
            const count = item.mode === 'waiting' ? waiting.length : 0
            return (
              <div
                key={item.mode}
                className="sidebar-row"
                data-active={isActive}
                onClick={() => goNav(item)}
              >
                <Icon
                  style={{
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    color: isActive ? item.color : 'var(--sidebar-foreground)',
                  }}
                  strokeWidth={isActive ? 2.3 : 2}
                />
                <span
                  style={{
                    fontSize: 17,
                    fontWeight: 500,
                    flex: 1,
                    color: isActive ? 'var(--sidebar-primary)' : 'inherit',
                  }}
                >
                  {item.label}
                </span>
                {count > 0 && (
                  <span style={{ fontSize: 14, color: 'var(--muted-foreground)', flexShrink: 0 }}>
                    {count}
                  </span>
                )}
              </div>
            )
          })}

          {/* Logical per-tag lists — every tag in use across active tasks */}
          {tags.map((tag) => {
            const path = `/tag/${encodeURIComponent(tag)}`
            const isActive = location.pathname === path
            return (
              <div
                key={tag}
                className="sidebar-row"
                data-active={isActive}
                onClick={() => void navigate(path)}
              >
                <Tag
                  style={{
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    color: isActive ? '#EC4899' : 'var(--ui-text-muted)',
                  }}
                  strokeWidth={isActive ? 2.3 : 2}
                />
                <span style={{ fontSize: 17, fontWeight: 500, color: isActive ? 'var(--sidebar-primary)' : 'inherit' }}>
                  {tag}
                </span>
              </div>
            )
          })}
        </div>
      </nav>

      {/* Divider */}
      <div style={{ margin: '4px 12px', borderTop: '1px solid var(--sidebar-border)' }} />

      {/* Collection list */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '4px 8px 0' }}>
        <div className="flex flex-col" style={{ gap: 1 }}>
          {ungrouped.map(renderRow)}

          {sortedGroups.map((groupName) => (
            <div key={groupName}>
              <div style={{ padding: '10px 10px 4px' }}>
                <span style={{
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--muted-foreground)',
                }}>
                  {groupName}
                </span>
              </div>
              {groupMap.get(groupName)!.map(renderRow)}
            </div>
          ))}

          {sharedWithMe.length > 0 && (
            <div>
              <div style={{ padding: '10px 10px 4px' }}>
                <span style={{
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--muted-foreground)',
                }}>
                  Shared with me
                </span>
              </div>
              {sharedWithMe.map(renderRow)}
            </div>
          )}

          {visible.length === 0 && (
            <p style={{ padding: '8px 10px 4px', fontSize: 16, color: 'var(--ui-text-muted)' }}>
              No projects yet.
            </p>
          )}

          <div
            className="sidebar-row"
            onClick={() => setNewListOpen(true)}
            style={{ color: 'var(--ui-text-muted)' }}
          >
            <Plus style={{ width: 14, height: 14, flexShrink: 0 }} />
            <span style={{ fontSize: 17, fontWeight: 500 }}>New list</span>
          </div>
        </div>
      </div>

      <NewCollectionDialog open={newListOpen} onOpenChange={setNewListOpen} />

      {settingsFor && (
        <ProjectSettingsDialog
          collectionRef={settingsFor}
          open
          onOpenChange={(open) => { if (!open) setSettingsFor(null) }}
        />
      )}

      <CalDavUrlDialog col={urlFor} onClose={() => setUrlFor(null)} />

      {/* Footer: account + utilities (icons reveal on hover, like row actions) */}
      <AccountFooter
        me={me}
        theme={theme}
        onUsers={() => void navigate('/users')}
        usersActive={location.pathname.startsWith('/users')}
        onLogout={logout}
        onToggleTheme={toggleTheme}
      />
    </aside>
  )
}

/**
 * The collection's address for third-party CalDAV clients (Apple Reminders,
 * Tasks.org, Thunderbird…), with one-click copy.
 */
function CalDavUrlDialog({ col, onClose }: { col: Collection | null; onClose: () => void }) {
  const url = col ? `${window.location.origin}${col.href}` : ''
  return (
    <Dialog open={!!col} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>CalDAV address{col ? ` — ${col.display_name}` : ''}</DialogTitle>
        </DialogHeader>
        <p style={{ fontSize: 15, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
          Add this list to any CalDAV client using the URL below, signing in
          with your CalStakk username and password.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code
            style={{
              flex: 1, minWidth: 0, fontSize: 14, padding: '8px 10px', borderRadius: 6,
              background: 'var(--muted)', color: 'var(--foreground)',
              overflowX: 'auto', whiteSpace: 'nowrap',
            }}
          >
            {url}
          </code>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(url)
              toast.success('URL copied')
            }}
          >
            Copy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AccountFooter({
  me,
  theme,
  onUsers,
  usersActive,
  onLogout,
  onToggleTheme,
}: {
  me: Me | null
  theme: 'light' | 'dark'
  onUsers: () => void
  usersActive: boolean
  onLogout: () => void
  onToggleTheme: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const showIcons = hovered || usersActive
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderTop: '1px solid var(--sidebar-border)',
        padding: '10px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
      }}
    >
      {me ? (
        <UserAvatar username={me.username} displayName={me.displayName} size={28} />
      ) : (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--sidebar-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <User style={{ width: 14, height: 14, color: 'var(--sidebar-foreground)' }} />
        </div>
      )}
      <span
        title={me ? `Signed in as ${me.username}` : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--sidebar-foreground)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {me?.displayName || me?.username || 'Account'}
      </span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          maxWidth: showIcons ? 120 : 0,
          overflow: 'hidden',
          opacity: showIcons ? 1 : 0,
          pointerEvents: showIcons ? 'auto' : 'none',
          transition: 'opacity 120ms, max-width 160ms ease',
          flexShrink: 0,
        }}
      >
        {me?.isAdmin && (
          <FooterIconButton onClick={onUsers} title="Manage users" active={usersActive}>
            <Users style={{ width: 14, height: 14 }} />
          </FooterIconButton>
        )}
        {hasSession() && (
          <FooterIconButton onClick={onLogout} title="Sign out">
            <LogOut style={{ width: 14, height: 14 }} />
          </FooterIconButton>
        )}
        <FooterIconButton
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark'
            ? <Sun style={{ width: 14, height: 14 }} />
            : <Moon style={{ width: 14, height: 14 }} />}
        </FooterIconButton>
      </div>
    </div>
  )
}

function FooterIconButton({
  onClick,
  title,
  active = false,
  children,
}: {
  onClick: () => void
  title: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        borderRadius: 6,
        border: 'none',
        background: active ? 'var(--sidebar-accent)' : 'transparent',
        color: active ? 'var(--sidebar-primary)' : 'var(--ui-text-muted)',
        cursor: 'pointer',
        transition: 'color 100ms, background 100ms',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--sidebar-primary)'
        e.currentTarget.style.background = 'var(--sidebar-accent)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = active ? 'var(--sidebar-primary)' : 'var(--ui-text-muted)'
        e.currentTarget.style.background = active ? 'var(--sidebar-accent)' : 'transparent'
      }}
    >
      {children}
    </button>
  )
}
