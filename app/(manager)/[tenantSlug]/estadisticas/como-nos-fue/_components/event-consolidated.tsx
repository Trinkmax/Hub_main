'use client'

import { ArrowRight, Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import {
  DataTableBody,
  DataTableCell,
  DataTableFoot,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
} from '@/components/ui/data-table'
import {
  CONSOLIDATED_COLUMNS,
  type ConsolidatedCell,
  type ConsolidatedResult,
  type ConsolidatedRow,
  type EventConsolidated as Data,
} from '@/lib/salon/event-consolidated'
import { cn } from '@/lib/utils'
import { CuadroExportButton } from './cuadro-export-button'
import { MathStep } from './marketing-report'

/**
 * «Rentabilidad» (02/10, antes «Consolidado»): la cuenta de cada fecha de un
 * evento, al lado de «Conversión», para decir de un vistazo en cuál dejó plata
 * y en cuál no (D1/D2 del 30/09/2026). Su «Exportar» baja exactamente esta
 * tabla (`eventProfitabilityToCsv`).
 *
 * Una sola pieza con dos formas, elegidas por el ancho de SU contenedor (no de
 * la pantalla): tarjetas debajo de 30rem (el celular) y la tabla del boceto del
 * dueño desde 30rem (a 28rem se sale 3 px con «$ 1.136.488 abajo»). Las dos
 * están en el DOM y una se esconde por CSS, como en la pestaña Pauta.
 *
 * La tabla es la del kit (primitivos de `DataTable`): encabezado en `bg-muted`,
 * pelos en las celdas y el total con **la regla contable** (`DataTableFoot`).
 * Con el relleno de las celdas al mínimo (`--cell-px`) para que entre en la
 * columna de 32rem al lado de «Conversión».
 *
 * Todo lo que se lee sale armado de `buildEventConsolidated`: acá solo se
 * dibuja. Lo único propio es qué fechas están desplegadas (varias a la vez,
 * para comparar dos desgloses).
 */

/** Los rótulos de la tabla, a 12 px: es una tabla angosta y el cuerpo también va a 12. */
const TH = 'type-caption font-medium'

/** Rellenos de la primera y la última columna (las del medio usan `--cell-px`). */
const FIRST_COL = 'ps-3'
const LAST_COL = 'pe-3'

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
    return <Check aria-hidden strokeWidth={2.5} className="size-3.5 shrink-0 text-success-text" />
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
            big && judged && 'font-display text-lg leading-none font-[520]',
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
      className="space-y-1.5 rounded-lg bg-secondary px-3 py-2.5 text-left text-xs leading-relaxed text-muted-foreground"
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
        className="inline-flex min-h-11 items-center gap-1 rounded-sm font-medium text-foreground underline-offset-[3px] outline-offset-2 outline-(--ring) hover:underline focus-visible:outline-2 pointer-fine:min-h-7"
      >
        Ver la noche
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  )
}

export function EventConsolidated({
  data,
  tenantSlug,
  exportAction,
}: {
  data: Data
  tenantSlug: string
  /** El «Exportar» del cuadro (`cuadroExport('rentabilidad', …)`). */
  exportAction: { href: string; label: string; ariaLabel: string; title: string }
}) {
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
      className="@container min-w-0 rounded-xl border border-border bg-card text-card-foreground"
    >
      {/* Cabecera (C4): título y «Exportar» en el renglón 1; el subtítulo a lo
          ancho debajo (a 360 px no entra al lado del botón); el titular de
          siempre abajo. */}
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="type-subtitle text-foreground">
            {data.title}
          </h2>
          <CuadroExportButton {...exportAction} />
        </div>
        <p className="mt-1 type-caption text-muted-foreground">{data.subtitle}</p>
        <p className="mt-2 text-pretty type-body">
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
      <ul aria-label={data.caption} className="divide-y divide-border @min-[30rem]:hidden">
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
                  className="group flex w-full items-baseline justify-between gap-3 text-left outline-none after:absolute after:-inset-1.5 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-(--ring)"
                >
                  <span className="flex items-center gap-2">
                    <span className="type-caption type-amount text-muted-foreground">
                      {r.weekdayLabel}
                    </span>
                    <ChevronDown
                      aria-hidden
                      className="size-3.5 text-muted-foreground transition-transform duration-(--duration-quick) ease-(--ease-ui) group-aria-expanded:rotate-180 motion-reduce:transition-none"
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
        // El total de las tarjetas, con la regla contable: raya arriba y doble abajo.
        <div className="border-t border-t-rule border-b-[3px] border-b-rule px-4 py-3 [border-bottom-style:double] @min-[30rem]:hidden">
          <p
            className={cn(
              'type-body font-medium text-pretty',
              total.negative && 'text-warning-text',
            )}
          >
            {total.sentence}
          </p>
          <p className="mt-0.5 type-caption text-muted-foreground">{total.cardLine}</p>
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
      <DataTableScroll className="relative hidden @min-[30rem]:block">
        <DataTableRoot
          caption={data.caption}
          density="compact"
          className="type-caption tabular-nums data-[density=compact]:[--cell-px:0.375rem]"
        >
          <DataTableHead>
            <tr>
              {CONSOLIDATED_COLUMNS.map((c) => (
                <DataTableHeader
                  key={c.key}
                  numeric={c.key !== 'date'}
                  className={cn(
                    TH,
                    c.key === 'date' ? FIRST_COL : null,
                    c.key === 'result' ? LAST_COL : null,
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
                </DataTableHeader>
              ))}
            </tr>
          </DataTableHead>
          <DataTableBody>
            {data.rows.map((r) => {
              const isOpen = open.has(r.eventId)
              const panelId = `${uid}-t-${r.eventId}`
              return [
                <DataTableRow key={r.eventId} className={cn(isOpen && 'bg-muted/40')}>
                  <th
                    scope="row"
                    className={cn(
                      'px-[var(--cell-px)] py-[var(--cell-py)] text-left align-top font-normal',
                      FIRST_COL,
                    )}
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      aria-label={r.toggleLabel}
                      onClick={() => toggle(r.eventId)}
                      className="group inline-flex items-center gap-1 whitespace-nowrap rounded-sm type-amount outline-offset-2 outline-(--ring) hover:text-foreground focus-visible:outline-2 pointer-coarse:min-h-11"
                    >
                      {r.dayMonth}
                      <ChevronRight
                        aria-hidden
                        className="size-3 text-muted-foreground transition-transform duration-(--duration-quick) ease-(--ease-ui) group-aria-expanded:rotate-90 motion-reduce:transition-none"
                      />
                    </button>
                  </th>
                  <DataTableCell numeric className="align-top">
                    <Cell cell={r.cells.guests} />
                  </DataTableCell>
                  {(['spend', 'perGuest', 'drinkPerGuest'] as const).map((k) => (
                    <DataTableCell
                      key={k}
                      numeric
                      className={cn('align-top', toneClass(r.cells[k].tone))}
                    >
                      <Cell cell={r.cells[k]} />
                    </DataTableCell>
                  ))}
                  {/* Sin `numeric` (que no deja partir): el motivo («faltan ingreso,
                      costo y dólar») baja de renglón; el monto no, por su `nowrap`. */}
                  <DataTableCell align="end" className={cn('align-top tabular-nums', LAST_COL)}>
                    <ResultText result={r.result} />
                    {axis !== null && r.bar !== null ? <ResultBar axis={axis} bar={r.bar} /> : null}
                  </DataTableCell>
                </DataTableRow>,
                isOpen ? (
                  <DataTableRow key={`${r.eventId}-desglose`} className="bg-muted/40">
                    <DataTableCell colSpan={6} className="px-3 pt-0 pb-3">
                      <Detail row={r} id={panelId} tenantSlug={tenantSlug} />
                    </DataTableCell>
                  </DataTableRow>
                ) : null,
              ]
            })}
          </DataTableBody>
          {total ? (
            <DataTableFoot>
              <tr className="align-top">
                <th
                  scope="row"
                  className={cn('px-[var(--cell-px)] py-[var(--cell-py)] text-left', FIRST_COL)}
                >
                  <span aria-hidden>
                    Total
                    <span className="block type-caption font-normal text-muted-foreground">
                      {total.base}
                    </span>
                  </span>
                  <span className="sr-only">{total.srLabel}</span>
                </th>
                <DataTableCell numeric className="align-top">
                  <Cell cell={total.cells.guests} />
                </DataTableCell>
                {(['spend', 'perGuest', 'drinkPerGuest'] as const).map((k) => (
                  <DataTableCell
                    key={k}
                    numeric
                    className={cn('align-top', toneClass(total.cells[k].tone))}
                  >
                    <Cell cell={total.cells[k]} />
                  </DataTableCell>
                ))}
                <DataTableCell align="end" className={cn('align-top tabular-nums', LAST_COL)}>
                  <ResultText result={total.result} />
                  {total.perPersonText ? (
                    <span className="block type-caption font-normal text-muted-foreground">
                      {total.perPersonText}
                    </span>
                  ) : null}
                </DataTableCell>
              </tr>
            </DataTableFoot>
          ) : null}
        </DataTableRoot>
      </DataTableScroll>

      {data.notes.length > 0 ? (
        <ul className="space-y-0.5 border-t border-border px-4 py-3 type-caption text-muted-foreground">
          {data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
