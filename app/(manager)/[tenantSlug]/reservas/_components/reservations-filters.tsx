'use client'

import { SlidersHorizontal, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableToolbar } from '@/components/ui/data-table'
import { Field } from '@/components/ui/field'
import { SearchField } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { UNPLACED_LABEL } from '@/lib/salon/event-floor'
import { STATUS_LABELS, ZONE_LABELS } from '@/lib/salon/types'
import { CommitDatePicker } from './commit-date-picker'

type Defaults = {
  q?: string
  status?: string
  zone?: string
  /** El servicio elegido en los chips. Solo para que "Limpiar" sepa que existe. */
  mealType?: string
  /** El tamaño de mesa elegido en los chips (`?mesa=`), por lo mismo. */
  partySize?: string
  managerId?: string
  dateFrom?: string
  dateTo?: string
}

/**
 * La barra de filtros de la lista (`DataTableToolbar` del kit): buscador, estado
 * y zona a la vista, y gestor y fechas en «Más filtros» (una hoja lateral).
 * Todo vive en la URL: el link se comparte por WhatsApp y muestra lo mismo.
 */
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
      defaults.mealType ||
      defaults.partySize ||
      defaults.managerId ||
      defaults.dateFrom ||
      defaults.dateTo,
  )
  // Lo que está escondido en la hoja: el botón dice cuántos hay puestos, si no
  // un filtro activo queda invisible y la lista "pierde" reservas sin razón.
  const advancedCount = [defaults.managerId, defaults.dateFrom, defaults.dateTo].filter(
    Boolean,
  ).length

  return (
    <DataTableToolbar aria-busy={pending || undefined}>
      <form action={handleSearchSubmit}>
        <SearchField
          name="q"
          placeholder="Buscar por nombre…"
          aria-label="Buscar por nombre del cliente"
          defaultValue={defaults.q}
          onClear={() => {
            if (defaults.q) pushQuery({ q: null })
          }}
        />
      </form>

      <Select
        value={defaults.status ?? 'all'}
        onValueChange={(v) => pushQuery({ status: v === 'all' ? null : v })}
      >
        <SelectTrigger aria-label="Estado" className="w-40">
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
        <SelectTrigger aria-label="Zona" className="w-40">
          <SelectValue placeholder="Zona" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las zonas</SelectItem>
          <SelectItem value="planta_alta">{ZONE_LABELS.planta_alta}</SelectItem>
          <SelectItem value="planta_baja">{ZONE_LABELS.planta_baja}</SelectItem>
          {/* Reservas de evento sin planta elegida: el mismo "Sin ubicar" del
              filtro de planta del calendario. */}
          <SelectItem value="event_floating">{UNPLACED_LABEL}</SelectItem>
        </SelectContent>
      </Select>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button variant="secondary">
            <SlidersHorizontal aria-hidden />
            Más filtros
            {advancedCount > 0 ? (
              <Badge tone="brand" appearance="solid" className="tabular-nums">
                {advancedCount}
                <span className="sr-only">{advancedCount === 1 ? 'activo' : 'activos'}</span>
              </Badge>
            ) : null}
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Más filtros</SheetTitle>
            <SheetDescription>Acotá por gestor o por un rango de fechas.</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-4">
            <Field label="Gestor">
              <Select
                value={defaults.managerId ?? 'all'}
                onValueChange={(v) => {
                  pushQuery({ manager: v === 'all' ? null : v })
                  setSheetOpen(false)
                }}
              >
                <SelectTrigger>
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
            </Field>
            <Field label="Desde">
              <CommitDatePicker
                defaultValue={defaults.dateFrom ?? null}
                clearable
                onCommit={(iso) => pushQuery({ from: iso })}
              />
            </Field>
            <Field label="Hasta">
              <CommitDatePicker
                defaultValue={defaults.dateTo ?? null}
                clearable
                onCommit={(iso) => pushQuery({ to: iso })}
              />
            </Field>
          </SheetBody>
        </SheetContent>
      </Sheet>

      {hasFilters ? (
        <Button variant="ghost" onClick={clearAll} disabled={pending}>
          <X aria-hidden />
          Limpiar
        </Button>
      ) : null}
    </DataTableToolbar>
  )
}
