import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import CodeMirror from '@uiw/react-codemirror'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'

interface Props {
  value: string | undefined
  onSave?: (value: string | undefined) => void
  onCancel?: () => void
  readOnly?: boolean
}

const editorTheme = EditorView.theme({
  '&': { padding: '12px 0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit' },
  '.cm-content': { fontSize: 14, lineHeight: 1.6 },
  '.cm-placeholder': { color: '#8A8A96', fontStyle: 'italic' },
})

export function MarkdownNotes({ value, onSave, onCancel, readOnly = false }: Props) {
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  const handleEditClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return
      e.stopPropagation()
      setDraft(value ?? '')
      setEditMode(true)
    },
    [value, readOnly],
  )

  const handleSave = useCallback(() => {
    if (!onSave) return
    const trimmed = draft.trim()
    onSave(trimmed || undefined)
    setEditMode(false)
  }, [draft, onSave])

  const handleCancel = useCallback(() => {
    setEditMode(false)
    onCancel?.()
  }, [onCancel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSave()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      }
    },
    [handleSave, handleCancel],
  )

  if (editMode) {
    return (
      <div onKeyDown={handleKeyDown}>
        <CodeMirror
          value={draft}
          extensions={[markdownLanguage, editorTheme]}
          theme={oneDark}
          onChange={(v) => setDraft(v)}
          placeholder="Write notes in Markdown…"
          height="240px"
          style={{ fontSize: 14, borderRadius: 6, overflow: 'hidden' }}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            bracketMatching: false,
            closeBrackets: false,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--foreground)',
              fontSize: 14,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: 'none',
              background: '#6366F1',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
      </div>
    )
  }

  if (value) {
    return (
      <div
        style={{ cursor: readOnly ? 'default' : 'pointer', lineHeight: 1.6, fontSize: 14 }}
        onClick={!readOnly ? handleEditClick : undefined}
      >
        <ReactMarkdown>{value}</ReactMarkdown>
      </div>
    )
  }

  if (readOnly) {
    return <p style={{ color: 'var(--muted-foreground)', margin: 0, fontSize: 14, lineHeight: 1.6 }}>No notes.</p>
  }

  return (
    <p
      style={{ color: 'var(--muted-foreground)', margin: 0, fontSize: 14, lineHeight: 1.6, cursor: 'pointer' }}
      onClick={handleEditClick}
    >
      Add notes…
    </p>
  )
}
