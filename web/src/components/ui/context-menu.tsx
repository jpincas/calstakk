import * as React from 'react'
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui'
import { ChevronRight } from 'lucide-react'

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuSub = ContextMenuPrimitive.Sub

function ContextMenuContent({ children, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        {...props}
        style={{
          minWidth: 180,
          padding: 4,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--popover)',
          boxShadow: 'var(--surface-shadow-md)',
          zIndex: 60,
          ...props.style,
        }}
      >
        {children}
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({ children, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      {...props}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 5,
        fontSize: 13,
        color: 'var(--popover-foreground)',
        cursor: 'pointer',
        outline: 'none',
        ...props.style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </ContextMenuPrimitive.Item>
  )
}

function ContextMenuSubTrigger({ children, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
  return (
    <ContextMenuPrimitive.SubTrigger
      {...props}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 5,
        fontSize: 13,
        color: 'var(--popover-foreground)',
        cursor: 'pointer',
        outline: 'none',
        ...props.style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
      <ChevronRight style={{ width: 13, height: 13, flexShrink: 0, opacity: 0.6 }} />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({ children, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        {...props}
        style={{
          minWidth: 160,
          padding: 4,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--popover)',
          boxShadow: 'var(--surface-shadow-md)',
          zIndex: 60,
          ...props.style,
        }}
      >
        {children}
      </ContextMenuPrimitive.SubContent>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuSeparator(props: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      {...props}
      style={{ height: 1, margin: '4px -4px', background: 'var(--border)', ...props.style }}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
}
