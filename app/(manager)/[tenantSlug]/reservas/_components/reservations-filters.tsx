'use client'

import { Filter, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { FilterBar, FilterSearch } from '@/components/ui/filter-bar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { STATUS_LABELS, ZONE_LABELS } from '@/lib/salon/types'

type Defaults = {
  q?: string
  status?: string
  zone?: string
  managerId?: string
  dateFrom?: string
  dateTo?: string
}

export function ReservationsFilters({
  tenantSlug,
  managers,
  defaults,
}: {
  tenantSlug: string
  managers: Array<{ id: string; display_name: string }>
  defaults: Defaults
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [sheetOpen, setSheetOpen] = useState(false)

  function pushQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp?.toString() ?? '')
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '' || v === 'all') next.delete(k)
      else next.set(k, v)
    }
    next.delete('page')
    startTransition(() => {
      router.push(`/${tenantSlug}/reservas?${next.toString()}`)
    })
  }

  function handleSearchSubmit(formData: FormData) {
    const q = String(formData.get('q') ?? '').trim()
    pushQuery({ q: q.length >= 2 ? q : null })
  }

  function clearAll() {
    startTransition(() => router.push(`/${tenantSlug}/reservas`))
  }

  const hasFilters = Boolean(
    defaults.q ||
      defaults.status ||
      defaults.zone ||
      defaults.managerId ||
      defaults.dateFrom ||
      defaults.dateTo,
  )

  return (
    <FilterBar className="flex-wrap">
      <form action={handleSearchSubmit} className="flex-1 min-w-[220px]">
        <FilterSearch name="q" placeholder="Buscar por nombre…" defaultValue={defaults.q} />
      </form>

      <Select
        value={defaults.status ?? 'all'}
        onValueChange={(v) => pushQuery({ status: v === 'all' ? null : v })}
      >
        <SelectTrigger className="h-9 w-[140px]">
          <SelectValue placeholder="Estado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          {(Object.keys(STATUS_LABELS) as Array<keyof typeof STATUS_LABELS>).map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={defaults.zone ?? 'all'}
        onValueChange={(v) => pushQuery({ zone: v === 'all' ? null : v })}
      >
        <SelectTrigger className="h-9 w-[160px]">
          <SelectValue placeholder="Zona" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las zonas</SelectItem>
          <SelectItem value="planta_alta">{ZONE_LABELS.planta_alta}</SelectItem>
          <SelectItem value="planta_baja">{ZONE_LABELS.planta_baja}</SelectItem>
          <SelectItem value="event_floating">Sujeta a evento</SelectItem>
        </SelectContent>
      </Select>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="size-4" />
            Más
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filtros avanzados</SheetTitle>
            <SheetDescription>Acotá por gestor o rango de fechas.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 py-6">
            <div className="block text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Gestor
              </span>
              <Select
                value={defaults.managerId ?? 'all'}
                onValueChange={(v) => {
                  pushQuery({ manager: v === 'all' ? null : v })
                  setSheetOpen(false)
                }}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los gestores</SelectItem>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="block text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Desde
              </span>
              <input
                type="date"
                defaultValue={defaults.dateFrom}
                onChange={(e) => pushQuery({ from: e.target.value || null })}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="block text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Hasta
              </span>
              <input
                type="date"
                defaultValue={defaults.dateTo}
                onChange={(e) => pushQuery({ to: e.target.value || null })}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={clearAll}
          disabled={pending}
        >
          <X className="size-4" />
          Limpiar
        </Button>
      ) : null}
    </FilterBar>
  )
}
