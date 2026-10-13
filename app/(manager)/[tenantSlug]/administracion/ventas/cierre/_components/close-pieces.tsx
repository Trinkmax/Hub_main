'use client'

import { Banknote, Check, type LucideIcon, Plus, SkipForward } from 'lucide-react'
import Link from 'next/link'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import { ChartSilhouette } from '@/components/administracion/charts/chart-parts'
import { SplitBar } from '@/components/administracion/charts/split-bar'
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
import type { ChannelSummary } from '@/lib/accounting/posting/sales-close'
import { CHANNEL_LABELS } from '@/lib/accounting/queries/labels'
import type { InvoiceSplit } from '../_lib/close-view'

/**
 * Las piezas de pantalla del cierre del día que no tienen estado propio: el
 * formulario les pasa sus números ya calculados y sus mismos manejadores, y
 * ellas solo dibujan. Están acá para que `sales-close-form.tsx` se pueda leer.
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
 * El día ya tiene cierre: cuánto suma, cómo se corrige (anular y cargar de
 * nuevo: no hay edición) y la puerta a cargar otro turno.
 */
export function ExistingCloses({
  closes,
  dayLabel,
  base,
  canAddShift,
  onAddShift,
}: {
  closes: ReadonlyArray<{ id: string; title: string; totalCents: number }>
  /** «lunes 05/10». */
  dayLabel: string
  /** `/<bar>/administracion`. */
  base: string
  /** Todavía no se abrió el formulario del otro turno. */
  canAddShift: boolean
  onAddShift: () => void
}) {
  const total = closes.reduce((sum, c) => sum + c.totalCents, 0)
  const single = closes.length === 1
  return (
    <section
      role="status"
      className="card-hairline flex flex-col gap-4 rounded-2xl border border-success/25 bg-success/6 p-4 shadow-xs sm:flex-row sm:items-end sm:justify-between sm:p-5"
    >
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
            single
              ? 'Para corregirlo, abrilo y anulalo; después cargalo de nuevo.'
              : 'En total. Para corregir uno, abrilo y anulalo; después cargalo de nuevo.'
          }
        />
      </div>
      <div className="flex flex-wrap gap-2">
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
    </section>
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
      <div className="flex flex-col gap-3 rounded-xl bg-secondary/50 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
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
      <div className="grid gap-4 rounded-xl bg-secondary/50 p-3 sm:grid-cols-2 sm:p-4">
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
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
 */
export function InvoiceSplitPanel({
  soldCents,
  split,
  channels,
}: {
  soldCents: number
  /** `null`: hay un importe fuera de rango y todavía no se puede repartir. */
  split: InvoiceSplit | null
  /** Los canales con movimiento. */
  channels: readonly ChannelSummary[]
}) {
  const hasSplit = split !== null && split.kind !== 'empty'
  return (
    <div className="grid gap-3 border-t border-border/60 pt-4">
      <h3 className="text-sm font-semibold leading-tight">Con factura y sin factura</h3>
      <SplitBar
        segments={[
          {
            key: 'invoiced',
            label: 'Con factura',
            cents: Math.max(0, split?.invoicedCents ?? 0),
            swatch: 'bg-adm-s1',
          },
          {
            key: 'uninvoiced',
            label: 'Sin factura',
            cents: split?.uninvoicedCents ?? 0,
            swatch: 'bg-adm-s4',
          },
        ]}
        ariaLabel={
          hasSplit && split
            ? `Con factura ${moneyLabel(split.invoicedCents)} y sin factura ${moneyLabel(split.uninvoicedCents)}`
            : undefined
        }
        emptyHint={
          <div className="space-y-2">
            <ChartSilhouette kind="split" />
            <p className="text-sm text-muted-foreground text-pretty">
              Cuando cargues lo vendido, acá vas a ver cuánto fue con factura y cuánto sin factura.
            </p>
          </div>
        }
      />
      {split?.kind === 'over' ? (
        <p className="text-sm text-warning-text text-pretty">
          Facturaste {moneyLabel(split.overCents)} más de lo que vendiste. Si es una factura de otro
          día, al guardar te pedimos que cuentes por qué.
        </p>
      ) : null}
      {channels.length > 1 ? (
        <ul className="grid gap-1 text-sm">
          {channels.map((c) => (
            <li key={c.channel} className="flex flex-wrap justify-between gap-x-3 tabular-nums">
              <span className="font-medium">{CHANNEL_LABELS[c.channel]}</span>
              <span className="text-muted-foreground">
                vendido {moneyLabel(c.soldCents)} · facturado {moneyLabel(c.invoicedTotalCents)} ·{' '}
                {c.uninvoicedCents < 0 ? (
                  <span className="text-warning-text">
                    facturado de más {moneyLabel(-c.uninvoicedCents)}
                  </span>
                ) : (
                  `sin factura ${moneyLabel(c.uninvoicedCents)}`
                )}
              </span>
            </li>
          ))}
        </ul>
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
