'use client'

import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SalonSearch({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar por mesa, alias o cliente"
        aria-label="Buscar mesa"
        className="w-full rounded-lg border border-border/70 bg-card/85 py-2.5 pl-9 pr-9 text-sm shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {value.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
          className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}
