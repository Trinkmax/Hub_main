'use client'

import { Loader2, ScanLine, Search, UserPlus, UserRound, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  isTouchPointer,
  useHydrated,
  useMediaQuery,
  WIDE_QUERY,
} from '@/components/purchasing/catalog/use-media-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { SlidingTabs } from '@/components/ui/sliding-tabs'
import type { CustomerByQr } from '@/lib/customers/queries'
import { type CustomerSearchResult, searchCustomers } from '@/lib/customers/search'
import { formatPhoneForDisplay } from '@/lib/phone'
import { loadEarnRate } from '@/lib/points/actions'
import type { EarnRate } from '@/lib/points/earn-rate'
import { cn } from '@/lib/utils'
import { AwardFlow } from './award-flow'
import { ScanScreen } from './scan-screen'

type Mode = 'search' | 'scan'

const MODES: { value: Mode; label: React.ReactNode }[] = [
  {
    value: 'search',
    label: (
      <span className="inline-flex items-center gap-1.5">
        <Search className="size-3.5" aria-hidden />
        Buscar persona
      </span>
    ),
  },
  {
    value: 'scan',
    label: (
      <span className="inline-flex items-center gap-1.5">
        <ScanLine className="size-3.5" aria-hidden />
        Escanear QR
      </span>
    ),
  },
]

/**
 * «Sumar puntos» del panel: una hoja sobre la pantalla en la que se está (al costado en la compu,
 * desde abajo en el celular), en vez de la pestaña «Acreditar» que era una pantalla entera para dos
 * botones.
 *
 * Dos caminos al mismo final (`AwardFlow`):
 *  - **Buscar persona**: el dueño en la compu no tiene el celular del cliente adelante; lo busca por
 *    nombre o teléfono. Es lo que abre en una pantalla sin dedo.
 *  - **Escanear QR**: el mismo escáner del salón (`ScanScreen`), que además entrega canjes y valida
 *    entradas. Es lo que abre en un celular o una tablet.
 *
 * Con `customer` (la ficha de un cliente) salta directo al monto.
 */
export function AwardPointsSheet({
  tenantSlug,
  customer,
  defaultOpen = false,
  variant = 'default',
  size = 'default',
  label = 'Sumar puntos',
  className,
}: {
  tenantSlug: string
  /** El cliente ya está elegido (su ficha): sin buscar ni escanear. */
  customer?: CustomerByQr
  /** Llega abierta: el buscador ⌘K y Tex la abren con `?sumar=1`. */
  defaultOpen?: boolean
  variant?: 'default' | 'outline'
  size?: 'default' | 'sm'
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [mode, setMode] = useState<Mode>('search')
  const [picked, setPicked] = useState<CustomerByQr | null>(null)
  const [earnRate, setEarnRate] = useState<EarnRate | null>(null)
  const wide = useMediaQuery(WIDE_QUERY)
  const hydrated = useHydrated()
  const shown = open && hydrated
  const asked = useRef(false)

  // La tasa se pide una sola vez, al abrir por primera vez: llega antes de que se termine de
  // escribir el monto.
  useEffect(() => {
    if (!shown || asked.current) return
    asked.current = true
    void loadEarnRate(tenantSlug)
      .then(setEarnRate)
      // Sin la tasa la hoja anda igual: solo no adelanta cuántos puntos suma.
      .catch(() => {})
  }, [shown, tenantSlug])

  const openSheet = () => {
    // Con el dedo (celular, tablet) lo natural es apuntarle al QR; con mouse, buscar.
    setMode(isTouchPointer() ? 'scan' : 'search')
    setPicked(null)
    setOpen(true)
  }

  // Abierta por la URL: no pasó por `openSheet`, así que elige el camino acá.
  const initialised = useRef(false)
  useEffect(() => {
    if (!hydrated || initialised.current) return
    initialised.current = true
    if (defaultOpen && isTouchPointer()) setMode('scan')
  }, [hydrated, defaultOpen])

  const current = customer ?? picked
  const choosing = !current

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={cn('gap-2', className)}
        onClick={openSheet}
      >
        <ScanLine className="size-4" aria-hidden />
        {label}
      </Button>

      <Sheet open={shown} onOpenChange={setOpen}>
        <SheetContent
          side={wide ? 'right' : 'bottom'}
          showClose={false}
          className={cn(
            'gap-0 p-0 outline-none',
            wide ? 'w-full sm:max-w-md' : 'h-[calc(100dvh-2.5rem)]',
          )}
        >
          {wide ? null : <SheetGrabber />}
          <SheetHeader className="shrink-0 gap-1 border-b border-border/60 px-4 pt-6 pr-16 pb-4 sm:px-6">
            <SheetTitle className="font-serif text-xl leading-tight font-semibold tracking-tight sm:text-2xl">
              Sumar puntos
            </SheetTitle>
            <SheetDescription className="text-pretty">
              {customer
                ? `Cargá lo que consumió ${customer.first_name}: los puntos se suman en el acto.`
                : 'Elegí a la persona, cargá lo que consumió y los puntos se suman en el acto.'}
            </SheetDescription>
            {choosing ? (
              <SlidingTabs
                size="sm"
                className="mt-3 w-fit"
                tabs={MODES}
                value={mode}
                onChange={setMode}
              />
            ) : null}
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
            {current ? (
              <AwardFlow
                // Otra persona, otro formulario: el monto escrito no se arrastra.
                key={current.id}
                tenantSlug={tenantSlug}
                customer={current}
                earnRate={earnRate}
                onReset={() => {
                  if (customer) setOpen(false)
                  else setPicked(null)
                }}
                resetLabel={customer ? 'Cerrar' : 'Elegir a otra persona'}
                resetIcon={customer ? <X className="size-4" aria-hidden /> : undefined}
                nextLabel={customer ? 'Listo' : 'Sumar a otra persona'}
              />
            ) : mode === 'scan' ? (
              // Solo montado mientras se mira: al cerrar la hoja o cambiar de camino, la cámara se suelta.
              <ScanScreen tenantSlug={tenantSlug} initialCode={null} earnRate={earnRate} />
            ) : (
              <CustomerSearch tenantSlug={tenantSlug} onPick={setPicked} />
            )}
          </div>

          <SheetClose className="absolute top-3 right-3 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:top-4 sm:right-4 sm:size-10">
            <X className="size-5 sm:size-4" aria-hidden />
            <span className="sr-only">Cerrar</span>
          </SheetClose>
        </SheetContent>
      </Sheet>
    </>
  )
}

/** Buscar por nombre o teléfono y elegir: el mismo buscador que usa el alta de una reserva. */
function CustomerSearch({
  tenantSlug,
  onPick,
}: {
  tenantSlug: string
  onPick: (customer: CustomerByQr) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const term = query.trim()

  useEffect(() => {
    if (term.length < 2) {
      setResults(null)
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    // Espera a que se deje de escribir: una consulta por palabra, no por tecla.
    const timer = window.setTimeout(() => {
      void searchCustomers(tenantSlug, term)
        .then((rows) => {
          if (alive) setResults(rows)
        })
        .catch(() => {
          if (alive) setResults([])
        })
        .finally(() => {
          if (alive) setSearching(false)
        })
    }, 220)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [tenantSlug, term])

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          autoFocus
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nombre, apellido o teléfono"
          aria-label="Buscar a la persona por nombre, apellido o teléfono"
          className="h-12 pl-10"
        />
        {searching ? (
          <Loader2
            className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>

      {results === null ? (
        <p className="px-1 text-sm text-muted-foreground text-pretty">
          Escribí al menos dos letras. Si tiene el celular a mano, es más rápido escanearle el QR de
          su billetera.
        </p>
      ) : results.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 p-5 text-center">
          <p className="text-sm font-medium">No hay nadie con «{term}»</p>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Si es la primera vez que viene, cargala y después sumale los puntos.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3 gap-1.5">
            <Link href={`/${tenantSlug}/clientes/nuevo`}>
              <UserPlus className="size-4" aria-hidden />
              Nuevo cliente
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
          {results.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() =>
                  onPick({
                    id: row.id,
                    first_name: row.first_name,
                    last_name: row.last_name,
                    phone: row.phone,
                    points_balance: row.points_balance,
                    // El buscador no trae el nivel: la ficha de arriba lo omite.
                    tier: null,
                  })
                }
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <UserRound className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {row.first_name} {row.last_name}
                  </span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {formatPhoneForDisplay(row.phone)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-display text-base font-semibold tabular-nums leading-none">
                    {row.points_balance.toLocaleString('es-AR')}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">puntos</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
