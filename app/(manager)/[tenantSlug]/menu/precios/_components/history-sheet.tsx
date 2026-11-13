'use client'

import { ChevronRight, History, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { loadPriceHistory } from '@/lib/menu/prices/actions'
import {
  batchText,
  changeText,
  type HistoryBatch,
  type HistoryChange,
  type HistoryEntry,
} from '@/lib/menu/prices/history'
import { SideSheet, SideSheetBody } from './side-sheet'

/** De qué se pide el historial: de un producto, o de toda la carta (`itemId` vacío). */
export type HistoryTarget = {
  itemId: string | null
  /** El nombre del producto, para el título. */
  name: string | null
  /** «Hoy cuesta $ 13.900.» y, si hay, lo que cuesta en cada sucursal con precio propio. */
  summary: string | null
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; entries: HistoryEntry[] }
  | { status: 'error'; message: string }

/** Dónde fue el cambio, cuando no fue en el precio de la carta. */
function where(entry: { branchName: string | null }): string {
  return entry.branchName ? ` · ${entry.branchName}` : ''
}

/** El riel de la línea de tiempo: un punto por renglón y la raya que los une. */
function Rail() {
  return (
    <>
      <span
        aria-hidden
        className="absolute top-[0.4rem] left-0 size-2.5 rounded-full border-2 border-background bg-muted-foreground"
      />
      <span
        aria-hidden
        className="absolute top-4 bottom-0 left-[4.5px] w-px bg-border group-last/entry:hidden"
      />
    </>
  )
}

/**
 * Un cambio. `byDay`: la lista es de toda la carta y va separada por día, así que cada renglón
 * dice de qué producto es y alcanza con la hora (el día ya está dicho arriba).
 */
function ChangeEntry({ entry, byDay }: { entry: HistoryChange; byDay: boolean }) {
  return (
    <li className="group/entry relative pb-5 pl-6 last:pb-0" data-testid="history-entry">
      <Rail />
      {byDay ? (
        <p className="text-sm font-medium [overflow-wrap:anywhere]">{entry.itemName}</p>
      ) : null}
      <p className={byDay ? 'text-sm tabular-nums' : 'text-[15px] font-medium tabular-nums'}>
        {changeText(entry)}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {byDay ? entry.time : entry.when} · {entry.who}
        {where(entry)}
      </p>
    </li>
  )
}

function BatchEntry({ entry, byDay }: { entry: HistoryBatch; byDay: boolean }) {
  return (
    <li className="group/entry relative pb-5 pl-6 last:pb-0" data-testid="history-batch">
      <Rail />
      <p className="text-[15px] font-medium text-pretty">{batchText(entry)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {byDay ? entry.time : entry.when} · {entry.who}
        {where(entry)}
      </p>
      <details className="group/all mt-1.5 text-sm">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-3.5 transition-transform duration-(--duration-fast) group-open/all:rotate-90 motion-reduce:transition-none"
          />
          Ver uno por uno
        </summary>
        <ul className="mt-1.5 divide-y divide-border/60 border-y border-border/60">
          {entry.changes.map((change) => (
            <li key={change.id} className="flex items-baseline gap-3 py-1.5">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {change.itemName}
                {change.branchName && !entry.branchName ? (
                  <span className="text-muted-foreground"> · {change.branchName}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-right text-muted-foreground tabular-nums">
                {changeText(change)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  )
}

function Timeline({ entries, byDay }: { entries: HistoryEntry[]; byDay: boolean }) {
  if (!byDay) {
    return (
      <ol aria-label="Cambios de precio, del más nuevo al más viejo">
        {entries.map((entry) =>
          entry.kind === 'batch' ? (
            <BatchEntry key={entry.id} entry={entry} byDay={false} />
          ) : (
            <ChangeEntry key={entry.id} entry={entry} byDay={false} />
          ),
        )}
      </ol>
    )
  }
  // Toda la carta: separado por día, para ubicar un cambio de un vistazo.
  const days: Array<{ day: string; label: string; entries: HistoryEntry[] }> = []
  for (const entry of entries) {
    const last = days[days.length - 1]
    if (last && last.day === entry.day) last.entries.push(entry)
    else days.push({ day: entry.day, label: entry.dayLabel, entries: [entry] })
  }
  return (
    <div className="space-y-6">
      {days.map((day) => (
        <section key={day.day || day.label}>
          <h3 className="mb-3 text-sm font-semibold">{day.label}</h3>
          <ol aria-label={`Cambios de ${day.label.toLowerCase()}`}>
            {day.entries.map((entry) =>
              entry.kind === 'batch' ? (
                <BatchEntry key={entry.id} entry={entry} byDay />
              ) : (
                <ChangeEntry key={entry.id} entry={entry} byDay />
              ),
            )}
          </ol>
        </section>
      ))}
    </div>
  )
}

function HistoryBody({ tenantSlug, target }: { tenantSlug: string; target: HistoryTarget }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const { itemId } = target

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const result = await loadPriceHistory(tenantSlug, { itemId })
      setState(
        result.ok
          ? { status: 'ready', entries: result.entries }
          : { status: 'error', message: result.message },
      )
    } catch {
      setState({
        status: 'error',
        message: 'No pudimos leer el historial: revisá la conexión y probá de nuevo.',
      })
    }
  }, [tenantSlug, itemId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <SideSheetBody>
      {state.status === 'loading' ? (
        <div className="space-y-5" aria-busy="true">
          <span className="sr-only">Leyendo el historial…</span>
          {['a', 'b', 'c', 'd'].map((key) => (
            <div key={key} className="space-y-2 pl-6">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : state.status === 'error' ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-pretty">
            {state.message}
          </p>
          <Button type="button" variant="outline" className="h-11 gap-2 sm:h-9" onClick={load}>
            <RotateCcw aria-hidden />
            Reintentar
          </Button>
        </div>
      ) : state.entries.length === 0 ? (
        <EmptyTeach
          plain
          icon={History}
          title={
            itemId === null
              ? 'Todavía no cambió ningún precio'
              : 'Este producto todavía no cambió de precio'
          }
        >
          Cada vez que alguien cambie un precio, acá queda anotado cuándo fue, de cuánto a cuánto y
          quién lo hizo. No hay que hacer nada: se anota solo.
        </EmptyTeach>
      ) : (
        <Timeline entries={state.entries} byDay={itemId === null} />
      )}
    </SideSheetBody>
  )
}

/**
 * El historial de precios: de un producto (una línea de tiempo, de lo más nuevo a lo más viejo)
 * o los últimos cambios de toda la carta, separados por día y con los aumentos plegados en un
 * renglón. Se lee recién al abrir.
 */
export function HistorySheet({
  tenantSlug,
  target,
  onClose,
}: {
  tenantSlug: string
  /** `null` = cerrada. */
  target: HistoryTarget | null
  onClose: () => void
}) {
  // Mientras la hoja se cierra sigue mostrando lo último que tenía (si no, el título saltaba
  // a «Últimos cambios» durante la animación de salida).
  const [shown, setShown] = useState(target)
  if (target !== null && target !== shown) setShown(target)

  return (
    <SideSheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      testId="history-sheet"
      title={shown?.name ?? 'Últimos cambios'}
      description={
        shown?.itemId
          ? `Historial de precios.${shown.summary ? ` ${shown.summary}` : ''}`
          : 'Los últimos cambios de precio de toda la carta, del más nuevo al más viejo.'
      }
    >
      {shown ? (
        <HistoryBody key={shown.itemId ?? 'carta'} tenantSlug={tenantSlug} target={shown} />
      ) : null}
    </SideSheet>
  )
}
