'use client'

import { SearchField } from '@/components/ui/input'

// Buscador de la carta. Es un campo controlado simple: el filtrado real lo hace
// el padre (MenuBoard) para que no haya que reordenar el árbol DnD.
export function MenuSearch({
  value,
  onChange,
  placeholder = 'Buscar una categoría…',
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}) {
  return (
    <SearchField
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClear={() => onChange('')}
      placeholder={placeholder}
      aria-label="Buscar una categoría de la carta"
    />
  )
}
