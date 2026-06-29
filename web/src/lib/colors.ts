export interface CollectionColor {
  bg: string
  text: string
  light: string
  border: string
  muted: string
}

export const PALETTE: CollectionColor[] = [
  { bg: '#2563eb', text: '#ffffff', light: '#eff6ff', border: '#93c5fd', muted: '#dbeafe' },
  { bg: '#059669', text: '#ffffff', light: '#ecfdf5', border: '#6ee7b7', muted: '#a7f3d0' },
  { bg: '#d97706', text: '#ffffff', light: '#fffbeb', border: '#fcd34d', muted: '#fde68a' },
  { bg: '#7c3aed', text: '#ffffff', light: '#f5f3ff', border: '#c4b5fd', muted: '#ddd6fe' },
  { bg: '#dc2626', text: '#ffffff', light: '#fef2f2', border: '#fca5a5', muted: '#fecaca' },
  { bg: '#0891b2', text: '#ffffff', light: '#ecfeff', border: '#67e8f9', muted: '#cffafe' },
  { bg: '#ea580c', text: '#ffffff', light: '#fff7ed', border: '#fdba74', muted: '#fed7aa' },
  { bg: '#be185d', text: '#ffffff', light: '#fdf2f8', border: '#f9a8d4', muted: '#fbcfe8' },
]

export function collectionColor(collections: string[], name: string): CollectionColor {
  const idx = collections.indexOf(name)
  return PALETTE[Math.max(0, idx) % PALETTE.length]
}
