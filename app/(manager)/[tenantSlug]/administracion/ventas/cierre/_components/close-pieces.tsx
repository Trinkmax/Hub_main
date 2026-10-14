'use client'

import {
  ArrowRight,
  Banknote,
  Check,
  ChevronRight,
  type LucideIcon,
  Plus,
  SkipForward,
} from 'lucide-react'
import Link from 'next/link'
import { type RefObject, useEffect, useId, useRef, useState } from 'react'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import { ChartLegend, ChartSilhouette } from '@/components/administracion/charts/chart-parts'
import { percentShort, sharePercents } from '@/components/administracion/charts/scale'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { EntryPreview, type EntryPreviewData } from '@/components/administracion/entry-preview'
import {
  Explain,
  MathRow,
  MoneyHero,
  StatusPill,
  Ticket,
  TicketHeader,
  TicketRow,
  TicketRule,
  TicketTotal,
} from '@/components/administracion/kit'
import { MoneyField } from '@/components/administracion/money-input'
import { Button } from '@/components/ui/button'
import { balanceStatus } from '@/lib/accounting/balance'
import type { ChannelSummary } from '@/lib/accounting/posting/sales-close'
import { CHANNEL_LABELS } from '@/lib/accounting/queries/labels'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { ControlCheck, InvoiceSplit } from '../_lib/close-view'

/**
 * Las piezas de pantalla del cierre del día que no tienen estado de formulario:
 * el formulario les pasa sus números ya calculados y sus mismos manejadores, y
 * ellas solo dibujan. Están acá para que `sales-close-form.tsx` se pueda leer.
 *
 * Las que van dentro de un paso miran el ancho de la COLUMNA de pasos
 * (`@container` en el formulario), no el de la pantalla: al lado del ticket la
 * columna mide menos que un celular acostado aunque la pantalla sea grande.
 */

/** El círculo con el ícono de un grupo de medios (de dónde sale el número). */
export function GroupIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-primary shadow-2xs"
    >
      <Icon className="size-4" />
    </span>
  )
}

/** El ticket de muestra del estado vacío: enseña qué se va a armar. Los números son de ejemplo. */
export function ExampleTicket() {
  return (
    <Ticket>
      <TicketHeader title="Cierre del día" subtitle="sábado" />
      <TicketRule />
      <TicketRow label="Efectivo" value="$ 350.000" />
      <TicketRow label="Tarjetas" value="$ 410.000" />
      <TicketRule double />
      <TicketTotal label="Total vendido" value="$ 760.000" />
    </Ticket>
  )
}

/**
 * El día ya tiene cierre: cuánto suma y QUÉ SIGUE (el próximo día que falta
 * o, si no falta ninguno, las ventas del mes). Ver el cierre y cargar otro
 * turno quedan al lado, más callados; cómo se corrige (anular y cargar de
 * nuevo: no hay edición) va en letra chica.
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
    <section
      role="status"
      className="card-hairline rounded-2xl border border-success/25 bg-success/6 p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-3">
          <StatusPill tone="ok" icon={Check}>
            {single ? 'Ya está cargado' : 'Ya están cargados'}
          </StatusPill>
          <MoneyHero
            size="md"
            cents={total}
            decimals={total % 100 === 0 ? 0 : 2}
            label={single ? `Cierre del ${dayLabel}` : `${closes.length} cierres del ${dayLabel}`}
            sentence={
              // Con el formulario del otro turno abierto, lo que sigue es ese formulario.
              !canAddShift
                ? single
                  ? 'Abajo cargás el otro turno de ese día.'
                  : 'En total. Abajo cargás otro turno de ese día.'
                : nextLabel
                  ? `Este día está listo. Sigue el del ${nextLabel}.`
                  : 'Este día está listo y no te falta ningún otro.'
            }
          />
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          {/* Una sola acción principal: seguir. Con el otro turno abierto, la principal es guardar. */}
          {canAddShift ? (
            <Button asChild className="h-12 gap-2 px-5 text-base md:h-11 md:text-sm">
              <Link href={nextHref}>
                {nextLabel ? `Cargar el del ${nextLabel}` : 'Ver las ventas del mes'}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          ) : null}
          <div className="flex flex-wrap gap-2 md:justify-end">
            {closes.map((c) => (
              <Button key={c.id} asChild variant="outline" className="h-11 md:h-9">
                <Link href={`${base}/comprobantes/${c.id}`}>
                  {single ? 'Ver el cierre' : `${c.title} · ${moneyLabel(c.totalCents)}`}
                </Link>
              </Button>
            ))}
            {canAddShift ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 gap-1.5 md:h-9"
                onClick={onAddShift}
              >
                <Plus className="size-4" aria-hidden />
                Cargar otro turno
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <p className="mt-4 border-t border-success/20 pt-3 text-xs text-muted-foreground text-pretty">
        {single
          ? '¿Quedó mal? Abrí el cierre y anulalo; después lo cargás de nuevo.'
          : '¿Quedó mal alguno? Abrilo y anulalo; después lo cargás de nuevo.'}
      </p>
    </section>
  )
}

/**
 * El total que dice el sistema de caja contra lo cargado, dicho como el
 * arqueo: una píldora con el estado y, al lado, cuánto es la diferencia. Si no
 * coincide el cierre no se guarda, así que no puede verse como una ayuda gris.
 * Ocupa siempre su renglón: al escribir no se mueve nada.
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
 * El arqueo del efectivo: lo que debería haber según lo cargado contra lo
 * contado, y la diferencia en palabras (nunca un menos pelado). `diffCents` es
 * el del formulario: vendido − contado, positivo = falta. «Saltear» y «Contar
 * la caja» son el mismo interruptor de siempre (`onToggle`).
 */
export function CashCount({
  methodName,
  open,
  soldCents,
  countedCents,
  diffCents,
  error,
  onCountedChange,
  onToggle,
}: {
  /** «Efectivo»: el medio que se cuenta. */
  methodName: string
  /** El paso está abierto (se cuenta) o salteado. */
  open: boolean
  soldCents: number
  countedCents: number | null
  diffCents: number
  error: string | null
  onCountedChange: (cents: number | null) => void
  onToggle: () => void
}) {
  if (!open) {
    return (
      <div className="flex flex-col gap-3 rounded-xl bg-secondary/50 p-3 @min-[30rem]:flex-row @min-[30rem]:items-center @min-[30rem]:justify-between @min-[30rem]:p-4">
        <p className="text-sm text-muted-foreground text-pretty">
          En este cierre no se cuenta la caja
          {soldCents > 0 ? `: entran los ${moneyLabel(soldCents)} que cargaste.` : '.'}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 shrink-0 gap-1.5 self-start md:h-9"
          aria-expanded={open}
          onClick={onToggle}
        >
          <Banknote className="size-4" aria-hidden />
          Contar la caja
        </Button>
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      <div className="grid gap-4 rounded-xl bg-secondary/50 p-3 @min-[30rem]:grid-cols-2 @min-[30rem]:p-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Debería haber
          </p>
          <p className="mt-1.5 font-serif text-2xl font-semibold leading-none tracking-tight tabular-nums">
            {soldCents > 0 ? moneyLabel(soldCents) : '—'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground text-pretty">
            {soldCents > 0
              ? `Lo que cargaste en ${methodName}.`
              : `Todavía no cargaste ventas en ${methodName}.`}
          </p>
        </div>
        <MoneyField
          label="Efectivo contado"
          value={countedCents}
          onValueChange={onCountedChange}
          decimals="auto"
          error={error}
        />
      </div>
      {/* El resultado ocupa siempre su renglón: al escribir no se mueve nada. */}
      <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {countedCents === null ? (
          <p className="text-muted-foreground">Escribí lo que contaste y te decimos si coincide.</p>
        ) : diffCents > 0 ? (
          <>
            <StatusPill tone="warn">Faltan {moneyLabel(diffCents)}</StatusPill>
            <span className="text-muted-foreground">Va a faltante de caja.</span>
          </>
        ) : diffCents < 0 ? (
          <>
            <StatusPill tone="info">Sobran {moneyLabel(-diffCents)}</StatusPill>
            <span className="text-muted-foreground">Va a sobrante de caja.</span>
          </>
        ) : (
          <>
            <StatusPill tone="ok" icon={Check}>
              Coincide
            </StatusPill>
            <span className="text-muted-foreground">con lo vendido.</span>
          </>
        )}
      </div>
      <div className="flex flex-col gap-2 @min-[30rem]:flex-row @min-[30rem]:items-center @min-[30rem]:justify-between @min-[30rem]:gap-4">
        <p className="text-xs text-muted-foreground text-pretty">
          Si pagaste algo con la plata de la caja, cargalo como gasto pagado con Caja; no lo restes
          acá.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 shrink-0 gap-1.5 self-start md:h-9"
          aria-expanded={open}
          onClick={onToggle}
        >
          <SkipForward className="size-4" aria-hidden />
          Saltear
        </Button>
      </div>
    </div>
  )
}

/**
 * «Con factura y sin factura», siempre a la vista: la barra partida con su
 * leyenda-tabla, el detalle por canal cuando hay más de uno y la cuenta
 * plegada. Los números son los de `summarizeSalesClose` (los del asiento).
 *
 * La leyenda la dibuja esta pieza y no la barra: acá los importes van AL
 * CENTAVO, iguales a los del ticket y a los del resumen de al lado (la barra
 * sola los redondea a pesos, que está bien para un tablero y no para una
 * carga).
 */
export function InvoiceSplitPanel({
  soldCents,
  split,
  channels,
  invoiceAsked,
  canInvoice = true,
}: {
  soldCents: number
  /** `null`: hay un importe fuera de rango y todavía no se puede repartir. */
  split: InvoiceSplit | null
  /** Los canales con movimiento. */
  channels: readonly ChannelSummary[]
  /**
   * Ya se sabe qué se facturó (no hay puntos de venta, o se anotó alguna factura). Mientras
   * no, «con factura» va con «—»: un «$ 0» afirmaría algo que nadie dijo todavía.
   */
  invoiceAsked: boolean
  /**
   * El bar tiene puntos de venta. Sin ellos no hay reparto que esperar: el vacío lo dice (todo
   * va a «sin factura») en vez de prometer un «con factura» que no se puede anotar.
   */
  canInvoice?: boolean
}) {
  const hasSplit = split !== null && split.kind !== 'empty'
  const invoiced = Math.max(0, split?.invoicedCents ?? 0)
  const uninvoiced = split?.uninvoicedCents ?? 0
  const parts = [
    { key: 'invoiced', label: 'Con factura', cents: invoiced, swatch: 'bg-adm-s1' },
    { key: 'uninvoiced', label: 'Sin factura', cents: uninvoiced, swatch: 'bg-adm-s4' },
  ]
  const shares = sharePercents(parts.map((p) => p.cents))
  // Si una parte tiene centavos, las dos los muestran: en columna, las comas alinean.
  const decimals = parts.some((p) => p.cents % 100 !== 0) ? 2 : 0

  return (
    <div className="grid gap-3 border-t border-border/60 pt-4">
      <h3 className="text-sm font-semibold leading-tight">Con factura y sin factura</h3>
      <SplitBar
        segments={parts}
        showLegend={false}
        ariaLabel={
          hasSplit && split
            ? `Con factura ${moneyLabel(split.invoicedCents)} y sin factura ${moneyLabel(split.uninvoicedCents)}`
            : undefined
        }
        emptyHint={
          <div className="space-y-2">
            <ChartSilhouette kind="split" />
            <p className="text-sm text-muted-foreground text-pretty">
              {canInvoice
                ? 'Cuando cargues lo vendido, acá vas a ver cuánto fue con factura y cuánto sin factura.'
                : 'Cuando cargues lo vendido lo vas a ver acá: mientras no tengas puntos de venta, todo del lado «sin factura».'}
            </p>
          </div>
        }
      />
      {invoiced + uninvoiced > 0 ? (
        <ChartLegend
          caption="Lo vendido, con factura y sin factura"
          rows={parts.map((p, i) => {
            // Todavía no se respondió «¿Qué facturaste?»: un solo «—», sin porcentaje.
            const pending = p.key === 'invoiced' && !invoiceAsked
            return {
              key: p.key,
              label: p.label,
              value: pending ? '—' : formatCents(p.cents, { decimals }),
              share: pending ? undefined : p.cents > 0 ? percentShort(shares[i] ?? 0, true) : '—',
              swatch: p.cents > 0 ? p.swatch : 'bg-adm-track',
              muted: p.cents <= 0,
            }
          })}
        />
      ) : null}
      {split?.kind === 'over' ? (
        <p className="text-sm text-warning-text text-pretty">
          Facturaste {moneyLabel(split.overCents)} más de lo que vendiste. Si es una factura de otro
          día, al guardar te pedimos que cuentes por qué.
        </p>
      ) : null}
      {channels.length > 1 ? (
        <ChannelBreakdown channels={channels} invoiceAsked={invoiceAsked} />
      ) : null}
      {hasSplit && split ? (
        <Explain note="Las dos partes quedan registradas en los libros. Lo facturado entra además al Libro IVA de ventas; cómo se trata lo demás lo define la contadora.">
          <MathRow label="Lo vendido" value={moneyLabel(soldCents)} />
          <MathRow
            op="−"
            label="Lo que facturaste (con IVA)"
            value={moneyLabel(split.invoicedCents)}
          />
          <MathRow
            op="="
            label={split.kind === 'over' ? 'Facturado de más' : 'Sin factura'}
            value={moneyLabel(split.kind === 'over' ? split.overCents : split.uninvoicedCents)}
          />
        </Explain>
      ) : (
        <p className="text-xs text-muted-foreground text-pretty">
          Las dos partes quedan registradas en los libros.
        </p>
      )}
    </div>
  )
}

/**
 * Salón y delivery, cada uno con sus tres importes EN SU COLUMNA: con lugar es
 * una tablita con encabezado; en angosto, cada canal con sus tres pares
 * etiqueta–importe apilados. Nunca tres números corridos en una oración.
 */
function ChannelBreakdown({
  channels,
  invoiceAsked,
}: {
  channels: readonly ChannelSummary[]
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
 * «Ver cómo queda en los libros»: el Debe y el Haber del cierre, para quien
 * quiera mirarlos. Es un renglón secundario que va DESPUÉS de guardar, a lo
 * ancho de la columna de pasos: plegado no ocupa nada ni muestra jerga
 * («Cuadra» aparece recién al abrirlo), y abierto no empuja al ticket ni al
 * botón de guardar.
 *
 * Mientras el cierre no se puede armar (falta cargar, o el total del sistema
 * de caja no coincide) dice eso en vez de «Sin importes».
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
  const panelId = useId()
  const empty = entries.every((entry) => balanceStatus(entry.lines) === 'empty')
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-4 transition-transform duration-(--duration-fast) motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        {open ? 'Ocultar cómo queda en los libros' : 'Ver cómo queda en los libros'}
      </button>
      <div id={panelId} hidden={!open} className="pt-1">
        {empty ? (
          <p className="rounded-xl bg-secondary/50 px-4 py-5 text-center text-sm text-muted-foreground text-pretty">
            {emptyText}
          </p>
        ) : (
          <EntryPreview
            alwaysOpen
            entries={entries}
            // El título propio de la pieza («Asiento») queda para lectores: el botón ya dijo
            // qué es. En el celular el código de cada cuenta se guarda (el nombre alcanza y
            // la fila queda en la mitad de alto) y, si un importe no entra, la tabla se
            // desliza de costado sin ensanchar la página.
            className="[&_h3]:sr-only [&>div:last-child]:overflow-x-auto max-sm:[&_td_.font-mono]:hidden"
          />
        )}
      </div>
    </div>
  )
}

/**
 * ¿Hay más contenido debajo de lo que se ve en una caja con scroll propio? El
 * ticket pegado puede no entrar de alto (muchos medios en una notebook): ahí
 * hace falta un «sigue» a la vista, no un desvanecido mudo.
 */
export function useMoreBelow<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [more, setMore] = useState(false)

  // Después de cada render: el contenido crece con cada importe que se carga.
  useEffect(() => {
    const el = ref.current
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 12)
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 12)
    el.addEventListener('scroll', update, { passive: true })
    // `toggle` (un <details> que se abre adentro) no burbujea: se escucha en captura.
    el.addEventListener('toggle', update, true)
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      el.removeEventListener('toggle', update, true)
      observer.disconnect()
    }
  }, [])

  return [ref, more]
}
