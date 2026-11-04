'use client'

import { ArrowRight, Check, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useId, useState } from 'react'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import { EntryPreview, type EntryPreviewData } from '@/components/administracion/entry-preview'
import { StatusPill } from '@/components/administracion/kit'
import { Planilla } from '@/components/administracion/planilla'
import { Button } from '@/components/ui/button'
import { balanceStatus } from '@/lib/accounting/balance'
import type { ChannelSummary } from '@/lib/accounting/posting/sales-close'
import { CHANNEL_LABELS } from '@/lib/accounting/queries/labels'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { ControlCheck } from '../_lib/close-view'

/**
 * Las piezas de pantalla del cierre del día que no tienen estado de formulario: el formulario les
 * pasa sus números ya calculados y sus mismos manejadores, y ellas solo dibujan. Están acá para que
 * `sales-close-form.tsx` se pueda leer.
 */

/**
 * Un renglón plegable de la hoja: lo que no se usa todos los días. Plegado no se dibuja lo de adentro
 * (su valor vive en el estado del formulario): así Enter pasa derecho de un campo al siguiente en vez
 * de trabarse en uno que no se ve.
 */
export function CloseFold({
  title,
  hint,
  open,
  onToggle,
  children,
}: {
  title: ReactNode
  /** A la derecha del rótulo, en gris: qué hay adentro. */
  hint?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const panelId = useId()
  return (
    <div className="border-t border-border/70">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex min-h-10 w-full items-center gap-1.5 px-3 text-left text-sm outline-none transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none pointer-coarse:min-h-11"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <span className="font-medium">{title}</span>
        {hint ? (
          <span className="ml-auto min-w-0 truncate pl-3 text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </button>
      <div id={panelId} hidden={!open} className="@container px-3 pt-1 pb-3">
        {open ? children : null}
      </div>
    </div>
  )
}

/**
 * El día ya tiene cierre: cuánto suma y QUÉ SIGUE (el próximo día que falta o, si no falta ninguno,
 * las ventas del mes). Ver el cierre y cargar otro turno quedan al lado, más callados; cómo se corrige
 * (anular y cargar de nuevo: no hay edición) va en letra chica.
 */
export function ExistingCloses({
  closes,
  dayLabel,
  base,
  canAddShift,
  onAddShift,
  nextHref,
  nextLabel,
}: {
  closes: ReadonlyArray<{ id: string; title: string; totalCents: number }>
  /** «lunes 05/10». */
  dayLabel: string
  /** `/<bar>/administracion`. */
  base: string
  /** Todavía no se abrió el formulario del otro turno. */
  canAddShift: boolean
  onAddShift: () => void
  /** A dónde seguir: el próximo día sin cierre, o las ventas del mes. */
  nextHref: string
  /** «miércoles 07/10» si falta otro día; `null` si están todos. */
  nextLabel: string | null
}) {
  const total = closes.reduce((sum, c) => sum + c.totalCents, 0)
  const single = closes.length === 1
  return (
    <Planilla>
      <section role="status" className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="min-w-0 space-y-1.5">
          <StatusPill tone="ok" icon={Check}>
            {single ? 'Ya está cargado' : 'Ya están cargados'}
          </StatusPill>
          <p className="text-sm text-pretty">
            {single ? `Cierre del ${dayLabel}` : `${closes.length} cierres del ${dayLabel}`}:{' '}
            <span className="font-semibold tabular-nums">{moneyLabel(total)}</span>
          </p>
          <p className="text-xs text-muted-foreground text-pretty">
            {/* Con el formulario del otro turno abierto, lo que sigue es ese formulario. */}
            {!canAddShift
              ? 'Abajo cargás otro turno de ese día.'
              : nextLabel
                ? `Este día está listo. Sigue el del ${nextLabel}.`
                : 'Este día está listo y no te falta ningún otro.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {closes.map((c) => (
            <Button key={c.id} asChild size="sm" variant="outline" className="pointer-coarse:h-10">
              <Link href={`${base}/comprobantes/${c.id}`}>
                {single ? 'Ver el cierre' : `${c.title} · ${moneyLabel(c.totalCents)}`}
              </Link>
            </Button>
          ))}
          {canAddShift ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="pointer-coarse:h-10"
                onClick={onAddShift}
              >
                Cargar otro turno
              </Button>
              {/* Una sola acción principal: seguir. Con el otro turno abierto, la principal es cargarlo. */}
              <Button asChild size="sm" className="gap-1.5 pointer-coarse:h-10">
                <Link href={nextHref}>
                  {nextLabel ? `Cargar el del ${nextLabel}` : 'Ver las ventas del mes'}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      </section>
      <p className="border-t border-border/70 px-3 py-2 text-xs text-muted-foreground text-pretty">
        {single
          ? '¿Quedó mal? Abrí el cierre y anulalo; después lo cargás de nuevo.'
          : '¿Quedó mal alguno? Abrilo y anulalo; después lo cargás de nuevo.'}
      </p>
    </Planilla>
  )
}

/**
 * El total que dice el sistema de caja contra lo cargado, dicho como el arqueo: una píldora con el
 * estado y, al lado, cuánto es la diferencia. Si no coincide el cierre no se guarda, así que no puede
 * verse como una ayuda gris. Ocupa siempre su renglón: al escribir no se mueve nada.
 */
export function ControlResult({ check }: { check: ControlCheck }) {
  return (
    <span className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
      {check.kind === 'none' ? (
        'Para controlar que no te falte ningún medio.'
      ) : check.kind === 'match' ? (
        <>
          <StatusPill tone="ok" icon={Check}>
            Coincide
          </StatusPill>
          <span>con lo que cargaste.</span>
        </>
      ) : (
        <>
          <StatusPill tone="warn">No coincide</StatusPill>
          <span className="text-sm text-foreground">
            {check.kind === 'short'
              ? `Te falta cargar ${moneyLabel(check.cents)}.`
              : `Cargaste ${moneyLabel(check.cents)} de más.`}
          </span>
        </>
      )}
    </span>
  )
}

/**
 * Lo vendido, con factura y sin factura de cada canal, EN SU COLUMNA: con lugar es una tablita con
 * encabezado; en angosto, cada canal con sus tres pares etiqueta–importe apilados. Nunca tres números
 * corridos en una oración. Los números son los de `summarizeSalesClose` (los del asiento).
 */
export function ChannelBreakdown({
  channels,
  invoiceAsked,
}: {
  channels: readonly ChannelSummary[]
  /** Ya se sabe qué se facturó. Mientras no, «con factura» va con «—», no con un «$ 0». */
  invoiceAsked: boolean
}) {
  const decimals = channels.some((c) =>
    [c.soldCents, c.invoicedTotalCents, c.uninvoicedCents].some((v) => v % 100 !== 0),
  )
    ? 2
    : 0
  const money = (cents: number) => formatCents(cents, { decimals })
  const pair =
    'flex items-baseline justify-between gap-3 @min-[34rem]:block @min-[34rem]:text-right'
  const label = 'text-muted-foreground @min-[34rem]:sr-only'
  const amount = 'whitespace-nowrap tabular-nums'
  return (
    <div className="grid gap-y-3 text-sm @min-[34rem]:grid-cols-[minmax(0,1fr)_auto_auto_auto] @min-[34rem]:gap-x-6 @min-[34rem]:gap-y-1.5">
      {/* El encabezado se ve con lugar; en angosto cada importe lleva su etiqueta al lado. */}
      <div
        aria-hidden
        className="hidden text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground @min-[34rem]:col-span-full @min-[34rem]:grid @min-[34rem]:grid-cols-subgrid"
      >
        <span>Por canal</span>
        <span className="text-right">Vendido</span>
        <span className="text-right">Con factura</span>
        <span className="text-right">Sin factura</span>
      </div>
      {channels.map((c) => {
        const over = c.uninvoicedCents < 0
        return (
          <div
            key={c.channel}
            className="grid gap-y-0.5 @min-[34rem]:col-span-full @min-[34rem]:grid-cols-subgrid"
          >
            <p className="font-medium">{CHANNEL_LABELS[c.channel]}</p>
            <p className={pair}>
              <span className={label}>Vendido</span>
              <span className={amount}>{money(c.soldCents)}</span>
            </p>
            <p className={pair}>
              <span className={label}>Con factura</span>
              <span className={amount}>{invoiceAsked ? money(c.invoicedTotalCents) : '—'}</span>
            </p>
            <p className={pair}>
              <span className={label}>{over ? 'Facturado de más' : 'Sin factura'}</span>
              <span className={cn(amount, over && 'text-warning-text')}>
                {money(Math.abs(c.uninvoicedCents))}
                {over ? <span className="hidden @min-[34rem]:inline"> de más</span> : null}
              </span>
            </p>
          </div>
        )
      })}
    </div>
  )
}

/**
 * «Ver el asiento»: el Debe y el Haber del cierre, para quien quiera mirarlos. Plegado no ocupa nada
 * ni muestra jerga («Cuadra» aparece recién al abrirlo).
 *
 * Mientras el cierre no se puede armar (falta cargar, o el total del sistema de caja no coincide) dice
 * eso en vez de «Sin importes».
 */
export function BooksPreview({
  entries,
  emptyText,
}: {
  entries: readonly EntryPreviewData[]
  /** Qué decir si todavía no hay nada para mostrar, y por qué. */
  emptyText: string
}) {
  const [open, setOpen] = useState(false)
  const empty = entries.every((entry) => balanceStatus(entry.lines) === 'empty')
  return (
    <CloseFold title="Ver el asiento" open={open} onToggle={() => setOpen((value) => !value)}>
      {empty ? (
        <p className="py-2 text-sm text-muted-foreground text-pretty">{emptyText}</p>
      ) : (
        <EntryPreview
          alwaysOpen
          entries={entries}
          // El título propio de la pieza («Asiento») queda para lectores: el botón ya dijo qué es. En
          // el celular el código de cada cuenta se guarda (el nombre alcanza y la fila queda en la
          // mitad de alto) y, si un importe no entra, la tabla se desliza sin ensanchar la página.
          className="[&_h3]:sr-only [&>div:last-child]:overflow-x-auto max-sm:[&_td_.font-mono]:hidden"
        />
      )}
    </CloseFold>
  )
}
