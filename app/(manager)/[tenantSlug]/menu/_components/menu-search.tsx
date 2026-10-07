'use client'

import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Buscador del catálogo. Es un input controlado simple — el filtrado real lo
// hace el parent (MenuBoard) para que no haya que reordenar el árbol DnD.
export function MenuSearch({
  value,
  onChange,
  placeholder = 'Buscar ítems o categorías…',
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-lg pl-9 pr-9"
        aria-label="Buscar en el menú"
      />
      {value.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Limpiar búsqueda"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 size-8 -translate-y-1/2 rounded-md text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}
