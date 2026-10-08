'use client'

import { Columns3 } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatIsoDay } from '@/lib/dates'
import { BANK_COLUMNS, type BankColumn, type BankLayout } from '@/lib/imports/bank/statement'
import type { Cell } from '@/lib/imports/types'
import {
  guessAssignment,
  headerRowOptions,
  layoutFromAssignment,
  mappingPreview,
  mappingProblems,
} from '@/lib/imports/ui/bank-mapping'
import { BANK_COLUMN_TEXT } from '@/lib/imports/ui/labels'
import { formatCents } from '@/lib/money'

export type MapperPreview =
  | {
      ok: true
      count: number
      items: ReadonlyArray<{ date: string; description: string; amount: number }>
    }
  | { ok: false; message: string }

const NONE = 'none'
const SELECT_CLASS = 'w-full data-[size=default]:h-11 md:data-[size=default]:h-10'

/**
 * «Contanos qué es cada columna» (diseño §4.3.2): el extracto vino con títulos
 * que no reconocemos. La persona elige qué es cada columna (con sus primeros
 * valores a la vista), ve cómo lo vamos a leer y lo confirma. El formato se
 * guarda y la próxima vez se reconoce solo.
 */
export function BankColumnMapper({
  rows,
  candidateHeaderRow,
  preview,
  onConfirm,
  onCancel,
}: {
  rows: readonly (readonly Cell[])[]
  candidateHeaderRow: number | null
  preview: (layout: BankLayout) => MapperPreview
  onConfirm: (layout: BankLayout) => void
  onCancel: () => void
}) {
  const titleId = useId()
  const headerId = useId()
  const orderId = useId()
  const options = useMemo(() => headerRowOptions(rows), [rows])
  const [headerRow, setHeaderRow] = useState<number>(candidateHeaderRow ?? options[0]?.index ?? 0)
  const [assignment, setAssignment] = useState<Record<number, BankColumn | null>>(() =>
    guessAssignment(rows, candidateHeaderRow ?? options[0]?.index ?? 0),
  )
  const [dateOrder, setDateOrder] = useState<'dmy' | 'mdy'>('dmy')

  const sample = useMemo(() => mappingPreview(rows, headerRow, 3), [rows, headerRow])
  const problems = useMemo(() => mappingProblems(assignment), [assignment])
  const layout = useMemo(
    () => (problems.length === 0 ? layoutFromAssignment(headerRow, assignment, dateOrder) : null),
    [problems, headerRow, assignment, dateOrder],
  )
  // `preview` vuelve a leer el archivo entero: solo cuando cambia lo elegido.
  const read = useMemo(() => (layout ? preview(layout) : null), [layout, preview])

  const changeHeader = (value: string) => {
    const next = Number(value)
    if (!Number.isInteger(next)) return
    setHeaderRow(next)
    setAssignment(guessAssignment(rows, next))
  }

  return (
    <section
      aria-labelledby={titleId}
      className="card-hairline space-y-5 rounded-xl border bg-card p-5 sm:p-6"
    >
      <header className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary shadow-2xs">
          <Columns3 className="size-5" aria-hidden />
        </span>
        <div className="space-y-1">
          <h2 id={titleId} className="font-serif text-lg font-semibold tracking-tight">
            Contanos qué es cada columna
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">
            No conocemos este formato de extracto. Decinos una sola vez qué trae cada columna: lo
            guardamos y la próxima vez lo leemos solos.
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={headerId}>¿En qué fila están los títulos?</Label>
          <Select value={String(headerRow)} onValueChange={changeHeader}>
            <SelectTrigger id={headerId} className={SELECT_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.index} value={String(o.index)}>
                  Fila {o.index + 1}: {o.preview}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Es la fila con los nombres de las columnas («Fecha», «Concepto»…).
          </p>
        </div>
        <div className="grid content-start gap-1.5">
          <p id={orderId} className="text-sm font-medium leading-none">
            Las fechas vienen como
          </p>
          <ChoiceChips
            labelledBy={orderId}
            value={dateOrder}
            onChange={setDateOrder}
            options={[
              { value: 'dmy', label: 'día/mes/año' },
              { value: 'mdy', label: 'mes/día/año' },
            ]}
          />
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sample.columns.map((column) => {
          const selectId = `${titleId}-col-${column.index}`
          const values = sample.sample.map((r) => r[column.index] ?? '').filter((v) => v !== '')
          return (
            <li key={column.index} className="grid gap-2 rounded-lg border border-border/70 p-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Columna {column.index + 1}
                </p>
                <p className="truncate font-medium" title={column.title}>
                  {column.title}
                </p>
              </div>
              <ul className="min-h-10 space-y-0.5 text-xs text-muted-foreground">
                {values.length === 0 ? <li>(vacía)</li> : null}
                {values.map((v, i) => (
                  <li key={`${column.index}-${i.toString()}`} className="truncate" title={v}>
                    {v}
                  </li>
                ))}
              </ul>
              <Label htmlFor={selectId} className="sr-only">
                Qué es la columna {column.index + 1} ({column.title})
              </Label>
              <Select
                value={assignment[column.index] ?? NONE}
                onValueChange={(value) =>
                  setAssignment((prev) => ({
                    ...prev,
                    [column.index]: value === NONE ? null : (value as BankColumn),
                  }))
                }
              >
                <SelectTrigger id={selectId} className={SELECT_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No la uses</SelectItem>
                  {BANK_COLUMNS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {BANK_COLUMN_TEXT[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          )
        })}
      </ul>

      <div aria-live="polite" className="space-y-3">
        {problems.length > 0 ? (
          <ul className="space-y-1 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning-text">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : read && !read.ok ? (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {read.message}
          </p>
        ) : read?.ok ? (
          <div className="rounded-xl border border-border/70 p-4">
            <p className="text-sm font-medium">
              Así lo vamos a leer ({read.count === 1 ? '1 movimiento' : `${read.count} movimientos`}
              ):
            </p>
            <ul className="mt-2 divide-y divide-border/60 text-sm">
              {read.items.map((it, i) => (
                <li
                  key={`${it.date}-${i.toString()}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="tabular-nums text-muted-foreground">
                      {formatIsoDay(it.date)}
                    </span>{' '}
                    {it.description}
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    {it.amount >= 0 ? 'Entra ' : 'Sale '}
                    {formatCents(Math.abs(it.amount))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onCancel}>
          Elegir otro archivo
        </Button>
        <Button
          type="button"
          className="h-11 md:h-9"
          disabled={!layout || !read?.ok}
          onClick={() => {
            if (layout && read?.ok) onConfirm(layout)
          }}
        >
          Usar estas columnas
        </Button>
      </div>
    </section>
  )
}
