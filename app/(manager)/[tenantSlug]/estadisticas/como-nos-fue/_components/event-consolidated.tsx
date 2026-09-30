'use client'

import { ArrowRight, Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import {
  CONSOLIDATED_COLUMNS,
  type ConsolidatedCell,
  type ConsolidatedResult,
  type ConsolidatedRow,
  type EventConsolidated as Data,
} from '@/lib/salon/event-consolidated'
import { cn } from '@/lib/utils'
import { MathStep } from './marketing-report'

/**
 * «Consolidado»: la cuenta de cada fecha de un evento, al lado de «Todas las
 * fechas», para decir de un vistazo en cuál dejó plata y en cuál no (D1/D2 del
 * 30/09/2026).
 *
 * Una sola pieza con dos formas, elegidas por el ancho de SU contenedor (no de
 * la pantalla): tarjetas debajo de 30rem (el celular) y la tabla del boceto del
 * dueño desde 30rem (a 28rem se sale 3 px con «$ 1.136.488 abajo»). Las dos
 * están en el DOM y una se esconde por CSS, como en la pestaña Pauta.
 *
 * Todo lo que se lee sale armado de `buildEventConsolidated`: acá solo se
 * dibuja. Lo único propio es qué fechas están desplegadas (varias a la vez,
 * para comparar dos desgloses).
 */

const TH = 'py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground'

function toneClass(tone: ConsolidatedCell['tone']): string | undefined {
  if (tone === 'warning') return 'text-warning-text'
  if (tone === 'muted') return 'text-muted-foreground'
  return undefined
}

/** Con `srText`, el lector oye eso en lugar de lo visible, que queda en `title`. */
function Cell({ cell }: { cell: ConsolidatedCell }) {
  if (cell.srText === null) return <>{cell.text}</>
  return (
    <>
      <span className="sr-only">{cell.srText}</span>
      <span aria-hidden title={cell.srText}>
        {cell.text}
      </span>
    </>
  )
}

/** ✓ dejó plata · ✗ quedó abajo · un hueco del mismo ancho si no hay marca (los montos quedan alineados). */
function Mark({ mark }: { mark: ConsolidatedResult['mark'] }) {
  if (mark === 'dejo') {
    return <Check aria-hidden strokeWidth={2.5} className="size-3.5 shrink-0 text-success" />
  }
  if (mark === 'abajo') {
    return <X aria-hidden strokeWidth={2.5} className="size-3.5 shrink-0 text-warning-text" />
  }
  return <span aria-hidden className="size-3.5 shrink-0" />
}

/** Un solo eje para todas las filas: la plata con signo, de un vistazo. Decorativa. */
function ResultBar({ axis, bar }: { axis: number; bar: ConsolidatedRow['bar'] }) {
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`
  return (
    <span aria-hidden className="relative mt-1.5 block h-1.5 w-full rounded-full bg-muted">
      <span className="absolute -inset-y-0.5 w-px bg-foreground/35" style={{ left: pct(axis) }} />
      {bar ? (
        <span
          className={cn(
            'absolute inset-y-0 rounded-full',
            bar.tone === 'positive' ? 'bg-success' : 'bg-warning-text',
          )}
          style={{ left: pct(bar.left), width: pct(bar.width) }}
        />
      ) : null}
    </span>
  )
}

/** El monto (o el motivo) con su marca, y «abajo» pegado cuando corresponde. */
function ResultText({ result, big = false }: { result: ConsolidatedResult; big?: boolean }) {
  const judged = result.mark !== null || result.tone !== 'muted' || result.suffix !== null
  return (
    <span className={cn('inline-flex items-baseline justify-end gap-1', toneClass(result.tone))}>
      <Mark mark={result.mark} />
      <span className="sr-only">{result.sr}</span>
      <span aria-hidden title={result.sr}>
        <span
          className={cn(
            'tabular-nums',
            // El monto no se parte; el motivo («faltan ingreso, costo y dólar») sí.
            judged && 'whitespace-nowrap',
            big && judged && 'font-serif text-lg font-semibold leading-none',
          )}
        >
          {result.text}
        </span>
        {result.suffix ? <span className="ml-1 text-xs">{result.suffix}</span> : null}
      </span>
    </span>
  )
}

function Detail({ row, id, tenantSlug }: { row: ConsolidatedRow; id: string; tenantSlug: string }) {
  return (
    <div
      id={id}
      className="space-y-1.5 rounded-lg bg-secondary/40 px-3 py-2.5 text-left text-xs leading-relaxed text-muted-foreground"
    >
      {row.detail.steps.length > 0 ? (
        <p className="tabular-nums">
          {row.detail.steps.map((step, i) => (
            <span key={`${step.before}|${step.after}`}>
              {i > 0 ? ' · ' : null}
              <MathStep step={step} />
            </span>
          ))}
          {row.detail.result ? (
            <>
              {' → '}
              <MathStep step={row.detail.result} />
            </>
          ) : null}
        </p>
      ) : null}
      {row.detail.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {row.reasonText ? <p>{row.reasonText}</p> : null}
      {row.detail.howToFix ? <p>{row.detail.howToFix}</p> : null}
      <Link
        href={`/${tenantSlug}/estadisticas/como-nos-fue?vista=dia&dia=${row.date}`}
        aria-label={row.linkLabel}
        className="inline-flex min-h-10 items-center gap-1 font-medium text-foreground/80 hover:text-foreground pointer-fine:min-h-7"
      >
        Ver la noche
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  )
}

export function EventConsolidated({ data, tenantSlug }: { data: Data; tenantSlug: string }) {
  const uid = useId()
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const titleId = `${uid}-titulo`
  const { total, axis } = data

  return (
    <section
      aria-labelledby={titleId}
      className="@container card-hairline min-w-0 rounded-xl border bg-card"
    >
      <header className="border-b border-border/60 px-4 py-3">
        <h2 id={titleId} className="font-serif text-base font-semibold tracking-tight">
          {data.title}
        </h2>
        <p className="mt-1 text-sm leading-snug">
          {data.headline.before}
          {data.headline.value ? (
            <span className="font-semibold tabular-nums">{data.headline.value}</span>
          ) : null}
          {data.headline.after}
          {data.unjudgedNote ? (
            <span className="text-muted-foreground"> {data.unjudgedNote}</span>
          ) : null}
        </p>
      </header>

      {/* Celular y columnas angostas: una tarjeta por fecha. */}
      <ul aria-label={data.caption} className="divide-y divide-border/60 @min-[30rem]:hidden">
        {data.rows.map((r) => {
          const isOpen = open.has(r.eventId)
          const panelId = `${uid}-c-${r.eventId}`
          return (
            <li key={r.eventId} className="px-4 py-3">
              <div className="relative">
                {/* El botón es el renglón 1 y su `after:` cubre la tarjeta: se
                    toca en cualquier lado (≥ 44 px) y el foco se ve entero. */}
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(r.eventId)}
                  className="group flex w-full items-baseline justify-between gap-3 text-left outline-none after:absolute after:-inset-1.5 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {r.weekdayLabel}
                    </span>
                    <ChevronDown
                      aria-hidden
                      className="size-3.5 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) group-aria-expanded:rotate-180 motion-reduce:transition-none"
                    />
                  </span>
                  <ResultText result={r.result} big />
                </button>
                {axis !== null && r.bar !== null ? <ResultBar axis={axis} bar={r.bar} /> : null}
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{r.cardLine}</p>
                {r.reasonText ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {r.reasonText}
                  </p>
                ) : null}
              </div>
              {isOpen ? (
                <div className="mt-2">
                  <Detail row={{ ...r, reasonText: null }} id={panelId} tenantSlug={tenantSlug} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      {total ? (
        <div className="border-t border-border/60 bg-secondary/30 px-4 py-3 @min-[30rem]:hidden">
          <p
            className={cn(
              'text-sm font-medium leading-snug',
              total.negative && 'text-warning-text',
            )}
          >
            {total.sentence}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{total.cardLine}</p>
        </div>
      ) : null}

      {/* Desde 30rem: la tabla del boceto. Con montos anchos (una pérdida de
          siete cifras, centavos en $/pers y en Bebida/p, pauta de cuatro
          cifras) su mínimo pasa los 32rem de la columna: lo que sobra se
          desplaza adentro de la tarjeta, en vez de salirse de ella o de darle
          scroll horizontal a la página. `relative` hace de esta caja el bloque
          contenedor de los `sr-only` (son `absolute`): sin él quedan fuera del
          recorte y, desde su lugar en la tabla, la página igual se corre
          (medido en Chrome: 24 px con la sección en 482 px). */}
      <div className="relative hidden overflow-x-auto @min-[30rem]:block">
        <table className="w-full text-xs tabular-nums">
          <caption className="sr-only">{data.caption}</caption>
          <thead>
            <tr className="border-b border-border/60 text-left">
              {CONSOLIDATED_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    TH,
                    c.key === 'date'
                      ? 'pr-1.5 pl-3'
                      : c.key === 'result'
                        ? 'pr-3 pl-1.5 text-right'
                        : 'px-1.5 text-right',
                  )}
                >
                  {c.srLabel ? (
                    <>
                      <span aria-hidden>{c.label}</span>
                      <span className="sr-only">{c.srLabel}</span>
                    </>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.rows.map((r) => {
              const isOpen = open.has(r.eventId)
              const panelId = `${uid}-t-${r.eventId}`
              return [
                <tr
                  key={r.eventId}
                  className={cn('align-top transition-colors', isOpen && 'bg-secondary/30')}
                >
                  <th scope="row" className="py-2 pr-1.5 pl-3 text-left font-normal">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      aria-label={r.toggleLabel}
                      onClick={() => toggle(r.eventId)}
                      className="group inline-flex items-center gap-1 whitespace-nowrap rounded-sm font-mono tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:min-h-10"
                    >
                      {r.dayMonth}
                      <ChevronRight
                        aria-hidden
                        className="size-3 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) group-aria-expanded:rotate-90 motion-reduce:transition-none"
                      />
                    </button>
                  </th>
                  <td className="px-1.5 py-2 text-right">
                    <Cell cell={r.cells.guests} />
                  </td>
                  {(['spend', 'perGuest', 'drinkPerGuest'] as const).map((k) => (
                    <td
                      key={k}
                      className={cn(
                        'whitespace-nowrap px-1.5 py-2 text-right',
                        toneClass(r.cells[k].tone),
                      )}
                    >
                      <Cell cell={r.cells[k]} />
                    </td>
                  ))}
                  <td className="py-2 pr-3 pl-1.5 text-right">
                    <ResultText result={r.result} />
                    {axis !== null && r.bar !== null ? <ResultBar axis={axis} bar={r.bar} /> : null}
                  </td>
                </tr>,
                isOpen ? (
                  <tr key={`${r.eventId}-desglose`} className="bg-secondary/30">
                    <td colSpan={6} className="px-3 pb-3">
                      <Detail row={r} id={panelId} tenantSlug={tenantSlug} />
                    </td>
                  </tr>
                ) : null,
              ]
            })}
          </tbody>
          {total ? (
            <tfoot className="border-t border-border">
              <tr className="align-top font-medium">
                <th scope="row" className="py-2 pr-1.5 pl-3 text-left">
                  <span aria-hidden>
                    Total
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {total.base}
                    </span>
                  </span>
                  <span className="sr-only">{total.srLabel}</span>
                </th>
                <td className="px-1.5 py-2 text-right">
                  <Cell cell={total.cells.guests} />
                </td>
                {(['spend', 'perGuest', 'drinkPerGuest'] as const).map((k) => (
                  <td
                    key={k}
                    className={cn(
                      'whitespace-nowrap px-1.5 py-2 text-right',
                      toneClass(total.cells[k].tone),
                    )}
                  >
                    <Cell cell={total.cells[k]} />
                  </td>
                ))}
                <td className="py-2 pr-3 pl-1.5 text-right">
                  <ResultText result={total.result} />
                  {total.perPersonText ? (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {total.perPersonText}
                    </span>
                  ) : null}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {data.notes.length > 0 ? (
        <ul className="space-y-0.5 border-t border-border/60 px-4 py-3 text-[11px] leading-snug text-muted-foreground">
          {data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
