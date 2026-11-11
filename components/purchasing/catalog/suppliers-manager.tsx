'use client'

import { AlertTriangle, CheckCircle2, MessageCircle, Plus, Search, Truck, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { cn } from '@/lib/utils'
import { FIELD_INPUT, matchesSearch } from './form-bits'
import { type SupplierAccounting, SupplierEditorSheet, type SupplierView } from './supplier-editor'
import { useSheetUrl } from './use-sheet-url'
import { WeekdayDots } from './weekdays'

/** `?editar=<id>` abre la ficha del proveedor · `?nuevo=1` una vacía. */
const SHEET_KEYS = ['editar', 'nuevo'] as const

function isMissing(supplier: SupplierView): boolean {
  return !supplier.whatsapp || supplier.deliveryWeekdays.length === 0
}

function byName(a: SupplierView, b: SupplierView) {
  return a.name.localeCompare(b.name, 'es')
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString('es-AR')} ${n === 1 ? one : many}`
}

function leadText(leadDays: number): string {
  if (leadDays === 0) return 'puede llegar el mismo día'
  return leadDays === 1 ? 'pedir con 1 día' : `pedir con ${leadDays} días`
}

/**
 * Los proveedores, con lo urgente arriba: los que no tienen WhatsApp o días de entrega (sin eso el
 * pedido no sale solo), primero los que tienen más insumos. Después los completos y al final los
 * desactivados. Tocar uno abre su ficha.
 */
export function SuppliersManager({
  tenantSlug,
  today,
  suppliers,
  accounting,
}: {
  tenantSlug: string
  today: string
  suppliers: readonly SupplierView[]
  /** Los proveedores de Administración para unir (vacío sin acceso allá) y si se puede unir. */
  accounting: SupplierAccounting
}) {
  const router = useRouter()
  const { params, open: openSheet, close: closeSheet } = useSheetUrl(SHEET_KEYS)
  const [query, setQuery] = useState('')

  const byId = new Map(suppliers.map((supplier) => [supplier.id, supplier]))
  const editId = params.get('editar')
  const creating = params.get('nuevo') === '1'
  const editing = editId ? (byId.get(editId) ?? null) : null
  const sheetOpen = creating || editing !== null
  // Lo que muestra la hoja mientras se cierra (la URL ya no lo tiene).
  const [mode, setMode] = useState<'new' | 'edit'>(creating ? 'new' : 'edit')
  const [shown, setShown] = useState<SupplierView | null>(editing)
  if (creating && mode !== 'new') setMode('new')
  if (editing && mode !== 'edit') setMode('edit')
  if (editing && editing !== shown) setShown(editing)

  const missing = editId !== null && !byId.has(editId)
  useEffect(() => {
    if (!missing) return
    toast.error('Ese proveedor ya no está en la lista.', { id: 'pur-supplier-missing' })
    closeSheet()
  }, [missing, closeSheet])

  const active = suppliers.filter((supplier) => supplier.active)
  const noWhatsapp = active.filter((supplier) => !supplier.whatsapp).length
  const noDays = active.filter((supplier) => supplier.deliveryWeekdays.length === 0).length

  const matches = suppliers.filter((supplier) =>
    matchesSearch(query, [
      supplier.name,
      supplier.contactName,
      supplier.whatsappDisplay,
      supplier.whatsapp,
    ]),
  )
  // Lo urgente: primero a quien más se le pide.
  const toComplete = matches
    .filter((supplier) => supplier.active && isMissing(supplier))
    .sort((a, b) => b.activeItems - a.activeItems || byName(a, b))
  const ready = matches.filter((supplier) => supplier.active && !isMissing(supplier)).sort(byName)
  const inactive = matches.filter((supplier) => !supplier.active).sort(byName)

  const open = (supplier: SupplierView) => openSheet({ editar: supplier.id })

  return (
    <>
      <PageHeader
        eyebrow="Compras"
        title="Proveedores"
        description="A quién se le pide cada cosa, por dónde y qué días trae la mercadería."
        actions={
          <Button
            type="button"
            onClick={() => openSheet({ nuevo: '1' })}
            className="h-11 flex-1 sm:flex-none md:h-10"
          >
            <Plus className="size-4" aria-hidden />
            Agregar proveedor
          </Button>
        }
      />

      {suppliers.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Todavía no hay proveedores"
          description="Cargá a quién le pedís. Con su WhatsApp y los días que entrega, cada pedido sale con un toque y se sabe cuándo llega."
          action={
            <Button
              type="button"
              onClick={() => openSheet({ nuevo: '1' })}
              className="h-11 md:h-10"
            >
              <Plus className="size-4" aria-hidden />
              Agregar proveedor
            </Button>
          }
        />
      ) : (
        <>
          {noWhatsapp || noDays ? (
            <MissingSummary noWhatsapp={noWhatsapp} noDays={noDays} />
          ) : active.length ? (
            <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
              Todos tienen WhatsApp y días de entrega: los pedidos salen solos.
            </p>
          ) : null}

          {suppliers.length > 6 ? (
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre, contacto o teléfono"
                aria-label="Buscar proveedores"
                enterKeyHint="search"
                autoComplete="off"
                className={cn(FIELD_INPUT, 'pr-11 pl-9 [&::-webkit-search-cancel-button]:hidden')}
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Borrar la búsqueda"
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
          ) : null}

          {matches.length === 0 ? (
            <EmptyState
              icon={Search}
              title={`No encontramos «${query.trim()}»`}
              description="Probá con otra parte del nombre o con el contacto."
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setQuery('')}
                  className="h-11 md:h-10"
                >
                  Ver todos
                </Button>
              }
            />
          ) : (
            <div className="space-y-8">
              {toComplete.length ? (
                <SupplierSection
                  id="para-completar"
                  title="Para completar"
                  count={toComplete.length}
                  description="Cargales lo que falta. Arriba, los que tienen más insumos."
                >
                  {toComplete.map((supplier) => (
                    <SupplierCard
                      key={supplier.id}
                      supplier={supplier}
                      onOpen={() => open(supplier)}
                    />
                  ))}
                </SupplierSection>
              ) : null}
              {ready.length ? (
                <SupplierSection
                  id="listos"
                  title={toComplete.length ? 'Listos' : 'Proveedores'}
                  count={ready.length}
                >
                  {ready.map((supplier) => (
                    <SupplierCard
                      key={supplier.id}
                      supplier={supplier}
                      onOpen={() => open(supplier)}
                    />
                  ))}
                </SupplierSection>
              ) : null}
              {inactive.length ? (
                <SupplierSection
                  id="desactivados"
                  title="Desactivados"
                  count={inactive.length}
                  description="No se les mandan pedidos."
                >
                  {inactive.map((supplier) => (
                    <SupplierCard
                      key={supplier.id}
                      supplier={supplier}
                      onOpen={() => open(supplier)}
                    />
                  ))}
                </SupplierSection>
              ) : null}
            </div>
          )}
        </>
      )}

      <SupplierEditorSheet
        tenantSlug={tenantSlug}
        today={today}
        open={sheetOpen}
        supplier={mode === 'edit' ? shown : null}
        accounting={accounting}
        onClose={closeSheet}
        onSaved={() => {
          closeSheet()
          router.refresh()
        }}
        onLinked={() => router.refresh()}
      />
    </>
  )
}

/** Lo que más urge cargar, como dos números grandes con la explicación abajo. */
function MissingSummary({ noWhatsapp, noDays }: { noWhatsapp: number; noDays: number }) {
  return (
    <section
      aria-labelledby="faltan-datos"
      className="card-hairline space-y-4 rounded-xl border border-warning/40 bg-card p-4 shadow-xs sm:p-5"
    >
      <h2
        id="faltan-datos"
        className="flex items-center gap-2 font-serif text-lg font-semibold tracking-tight"
      >
        <AlertTriangle className="size-5 shrink-0 text-warning-text" aria-hidden />
        Falta esto para que los pedidos salgan solos
      </h2>
      <dl className="grid grid-cols-2 gap-3">
        <MissingStat
          value={noWhatsapp}
          label={noWhatsapp === 1 ? 'proveedor sin WhatsApp' : 'proveedores sin WhatsApp'}
        />
        <MissingStat value={noDays} label="sin días de entrega" />
      </dl>
      <p className="text-sm text-muted-foreground text-pretty">
        Sin WhatsApp no se abre el chat con el pedido. Sin días de entrega no se calcula cuándo
        llega.
      </p>
    </section>
  )
}

/** El número grande arriba y lo que cuenta abajo; en 0, sin alarma. */
function MissingStat({ value, label }: { value: number; label: string }) {
  const tone = value ? 'text-warning-text' : 'text-success'
  return (
    <div
      // col-reverse + justify-end: el número arriba y a la misma altura en las dos tarjetas.
      className={cn(
        'flex flex-col-reverse justify-end gap-1 rounded-lg px-3 py-3',
        value ? 'bg-warning/10' : 'bg-success/10',
      )}
    >
      <dt className={cn('text-sm leading-snug text-pretty', tone)}>{label}</dt>
      <dd className={cn('font-serif text-4xl leading-none font-semibold tabular-nums', tone)}>
        {value.toLocaleString('es-AR')}
      </dd>
    </div>
  )
}

function SupplierSection({
  id,
  title,
  count,
  description,
  children,
}: {
  id: string
  title: string
  count: number
  description?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`seccion-${id}`} className="space-y-3">
      <header className="space-y-0.5 px-1">
        <h2
          id={`seccion-${id}`}
          className="flex items-baseline gap-2 font-serif text-lg font-semibold tracking-tight"
        >
          {title}
          <span className="font-sans text-sm font-normal text-muted-foreground tabular-nums">
            {count}
          </span>
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </header>
      <ul className="grid gap-3 lg:grid-cols-2">{children}</ul>
    </section>
  )
}

/** Un faltante adentro de la tarjeta (es un botón: todo `span`). */
function MissingLine({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-sm leading-snug text-warning-text">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 text-pretty">{children}</span>
    </span>
  )
}

function SupplierCard({ supplier, onOpen }: { supplier: SupplierView; onOpen: () => void }) {
  // A un desactivado no se le mandan pedidos: lo que le falta no es urgente y no se marca.
  const noWhatsapp = !supplier.whatsapp && supplier.active
  const noDays = supplier.deliveryWeekdays.length === 0 && supplier.active
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'card-hairline flex h-full w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors',
          'hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          !supplier.active && 'text-muted-foreground',
        )}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block font-serif text-lg leading-tight font-semibold text-pretty">
              {supplier.name}
            </span>
            <span className="mt-0.5 block truncate text-sm text-muted-foreground">
              {supplier.contactName ?? 'Sin contacto'}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-secondary-foreground tabular-nums">
              {plural(supplier.activeItems, 'insumo', 'insumos')}
            </span>
            {supplier.active ? null : (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                Desactivado
              </span>
            )}
          </span>
        </span>

        {supplier.whatsapp ? (
          <span className="flex items-center gap-2 text-sm">
            <MessageCircle className="size-4 shrink-0 text-success" aria-hidden />
            <span className="sr-only">WhatsApp: </span>
            <span className="tabular-nums">{supplier.whatsappDisplay ?? supplier.whatsapp}</span>
          </span>
        ) : noWhatsapp ? (
          <MissingLine>Sin WhatsApp no se abre el chat con el pedido.</MissingLine>
        ) : (
          <span className="text-sm text-muted-foreground">Sin WhatsApp</span>
        )}

        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <WeekdayDots days={supplier.deliveryWeekdays} />
          <span className="text-xs text-muted-foreground">{leadText(supplier.leadDays)}</span>
        </span>
        {supplier.parties.length > 1 ? (
          <span className="text-xs text-muted-foreground">
            Factura como {supplier.parties.map((p) => p.name).join(' y ')}
          </span>
        ) : null}
        {noDays ? <MissingLine>Sin días de entrega no se calcula cuándo llega.</MissingLine> : null}
      </button>
    </li>
  )
}
