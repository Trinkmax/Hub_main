'use client'

import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import {
  type FocusEvent,
  type KeyboardEvent,
  type RefCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { toast } from 'sonner'
import { scrollIntoViewOnTouch } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import {
  CELL_INPUT,
  Planilla,
  PlanillaFoot,
  PRow,
  PTable,
  PTd,
  PTh,
  PTotalRow,
  ROW_ACTION,
} from '@/components/administracion/planilla'
import { Stamp } from '@/components/administracion/planilla/stamp'
import { Totalizer } from '@/components/administracion/planilla/totalizer'
import { ActionButton, toastUndo } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { copyPreviousWeekBudgets, saveWeekBudgets } from '@/lib/accounting/actions/week-plan'
import {
  addToPlanLayout,
  type BudgetItem,
  initialPlanLayout,
  nextPlanLayout,
  overdueBudgetItems,
  type PlanParty,
  parseBudgetCell,
  paysOnReceipt,
  planLeft,
  planRows,
  pruneOverrides,
  restoreItems,
  revertOverrides,
  type WeekPlanRow,
  weekPlanTotals,
} from '@/lib/accounting/week-plan'
import { centsToPesosInput, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { NoAmount, ROW_ACTIONS_CELL, ROW_BUTTON, SheetEmpty } from '../../_components/planilla-bits'
import { newPurchaseHref, supplierHref, weekPlanHref } from '../../_lib/links'

const BUTTON = 'h-10 md:pointer-fine:h-8'

function Money({ cents }: { cents: number }) {
  return cents === 0 ? <NoAmount /> : formatCentsShort(cents)
}

/**
 * La barra fina de debajo del totalizador: cuánto del presupuesto ya se pagó. Crece al llegar y cada
 * vez que el número cambia; con «reducir movimiento», se queda quieta en su lugar.
 */
export function WeekProgress({
  percent,
  over,
  hasBudget,
}: {
  percent: number
  over: boolean
  hasBudget: boolean
}) {
  const reduce = useReducedMotion() ?? false
  return (
    <div
      role="img"
      aria-label={hasBudget ? `Pagaste el ${percent} % del presupuesto` : 'Todavía sin presupuesto'}
      className="h-1.5 overflow-hidden rounded-full bg-adm-track"
    >
      <motion.div
        className={cn('h-full rounded-full', over ? 'bg-destructive' : 'bg-primary')}
        initial={reduce ? false : { width: 0 }}
        animate={{ width: `${percent}%` }}
        transition={reduce ? { duration: 0 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  )
}

/**
 * La celda del presupuesto, en pesos: guarda al salir, Enter baja a la de abajo (las flechas también)
 * y Esc deja lo que había. Al entrar queda todo seleccionado, como en una planilla: se escribe encima.
 */
function BudgetCell({
  name,
  cents,
  onSave,
  onMove,
  inputRef,
}: {
  name: string
  cents: number
  onSave: (cents: number) => void
  /** `1` la de abajo, `-1` la de arriba. */
  onMove: (delta: 1 | -1) => void
  inputRef: RefCallback<HTMLInputElement>
}) {
  // `null` = no se está escribiendo: se ve lo guardado.
  const [draft, setDraft] = useState<string | null>(null)
  const discard = useRef(false)
  const stored = cents > 0 ? centsToPesosInput(cents, { decimals: 'auto' }) : ''

  const commit = () => {
    const text = draft
    setDraft(null)
    if (discard.current) {
      discard.current = false
      return
    }
    if (text === null) return
    const parsed = parseBudgetCell(text)
    if (!parsed.ok) {
      toast.error(parsed.message)
      return
    }
    if (parsed.cents !== cents) onSave(parsed.cents)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault()
      onMove(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      onMove(-1)
    } else if (event.key === 'Escape') {
      discard.current = true
      event.currentTarget.blur()
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint="next"
      aria-label={`Presupuesto de ${name}`}
      value={draft ?? stored}
      onFocus={(event: FocusEvent<HTMLInputElement>) => {
        setDraft(stored)
        event.currentTarget.select()
        scrollIntoViewOnTouch(event)
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={cn(CELL_INPUT, 'pointer-coarse:py-2')}
    />
  )
}

/** La columna «Falta»: lo que queda, «Listo» si llegó o «Te pasaste $ X». */
function LeftCell({ row, thud }: { row: WeekPlanRow; thud: boolean }) {
  const left = planLeft(row.budgetCents, row.paidCents)
  if (left.kind === 'none') return <NoAmount />
  if (left.kind === 'done') return <Stamp thud={thud}>Listo</Stamp>
  if (left.kind === 'over') {
    return <span className="text-destructive">Te pasaste {formatCentsShort(left.cents)}</span>
  }
  return <>{formatCentsShort(left.cents)}</>
}

/**
 * El Plan de la semana: la planilla «Pagos Proveedores» de Tomi. Proveedor · Deuda · Compró ·
 * Presupuesto · Pagó · Falta · [Pagar], con el totalizador y la barra arriba y la doble raya abajo.
 *
 * Lo que se escribe se ve al toque y se guarda solo; si la base no lo acepta, la celda vuelve a lo
 * que había y el aviso deja reintentar. Mientras está abierta, las filas no se mueven de lugar: Enter
 * siempre baja a la de abajo (`PlanLayout`). Va con `key={weekStart}`: otra semana es otra planilla.
 *
 * La contadora ve lo mismo en solo lectura.
 */
export function WeekSheet({
  tenantSlug,
  weekStart,
  rows,
  parties,
  canWrite,
  monthHref,
}: {
  tenantSlug: string
  /** El lunes. */
  weekStart: string
  rows: readonly WeekPlanRow[]
  /** Los que se pueden sumar con «+ Agregar proveedor». `null` si no se leyeron o no se puede. */
  parties: readonly PlanParty[] | null
  canWrite: boolean
  monthHref: string
}) {
  const [layout, setLayout] = useState(() => initialPlanLayout(rows))
  // Llegaron filas nuevas de la base: se acomodan sin mover las que ya estaban.
  if (layout.source !== rows) setLayout(nextPlanLayout(layout, rows))

  const [overrides, setOverrides] = useState<ReadonlyMap<string, number>>(() => new Map())
  useEffect(() => {
    setOverrides((previous) => pruneOverrides(previous, rows))
  }, [rows])

  const visible = useMemo(() => planRows(layout, rows, overrides), [layout, rows, overrides])
  const totals = weekPlanTotals(visible)

  const cells = useRef(new Map<string, HTMLInputElement>())
  const [focusOn, setFocusOn] = useState<string | null>(null)
  useEffect(() => {
    if (!focusOn) return
    cells.current.get(focusOn)?.focus()
    setFocusOn(null)
  }, [focusOn])

  // El último guardado de cada celda: uno viejo que falla no pisa lo que se escribió después.
  const lastSave = useRef(new Map<string, number>())
  const saveCount = useRef(0)

  const [bulkPending, startBulk] = useTransition()

  const budgetOf = (partyId: string) =>
    visible.find((row) => row.partyId === partyId)?.budgetCents ?? 0

  const applyOverrides = (items: readonly BudgetItem[]) =>
    setOverrides((previous) => {
      const next = new Map(previous)
      for (const item of items) next.set(item.partyId, item.amountCents)
      return next
    })

  /** Se ve al toque, se guarda y, si no se pudo, vuelve a lo que había. `true` si se guardó. */
  const save = async (items: readonly BudgetItem[]): Promise<boolean> => {
    applyOverrides(items)
    saveCount.current += 1
    const stamp = saveCount.current
    for (const item of items) lastSave.current.set(item.partyId, stamp)

    let failure: string | null = null
    try {
      const result = await saveWeekBudgets(tenantSlug, { weekStart, items })
      if (!result.ok) failure = result.message
    } catch {
      failure = ACC_UNREACHABLE.offline
    }
    if (failure === null) return true

    setOverrides((previous) =>
      revertOverrides(previous, items, (partyId) => lastSave.current.get(partyId) === stamp),
    )
    toast.error(failure, {
      action: { label: ACC_UNREACHABLE.retryLabel, onClick: () => void save(items) },
    })
    return false
  }

  const move = (partyId: string, delta: 1 | -1) => {
    const index = layout.ids.indexOf(partyId)
    const target = layout.ids[index + delta]
    if (target) cells.current.get(target)?.focus()
    else cells.current.get(partyId)?.blur()
  }

  // «Traer lo vencido»: lo que había se puede volver a poner.
  const overdue = overdueBudgetItems(visible)
  const bringOverdue = () => {
    if (overdue.length === 0) return
    const undo = restoreItems(overdue, budgetOf)
    startBulk(async () => {
      if (await save(overdue)) {
        toastUndo('Trajimos todo lo vencido. Ajustalo fila por fila.', {
          onUndo: async () => {
            await save(undo)
          },
        })
      }
    })
  }

  // «Copiar la semana pasada»: solo en las filas que están en cero, así que deshacer es volver a cero.
  const copyLastWeek = () =>
    startBulk(async () => {
      try {
        const result = await copyPreviousWeekBudgets(tenantSlug, { weekStart })
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        const { items } = result.data
        if (items.length === 0) {
          toast.info(result.message)
          return
        }
        applyOverrides(items)
        toastUndo(result.message, {
          onUndo: async () => {
            await save(items.map((item) => ({ partyId: item.partyId, amountCents: 0 })))
          },
        })
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      }
    })

  const options: PartyOption[] = useMemo(() => {
    const shown = new Set(layout.ids)
    return (parties ?? [])
      .filter((party) => !shown.has(party.id))
      .map((party) => ({
        id: party.id,
        name: party.name,
        tradeName: party.tradeName,
        taxId: party.taxId,
      }))
  }, [parties, layout.ids])

  // «Listo» cae de golpe solo cuando recién llegó: un sello que se mueve siempre es ruido.
  const wasDone = useRef<ReadonlySet<string> | null>(null)
  const done = visible
    .filter((row) => planLeft(row.budgetCents, row.paidCents).kind === 'done')
    .map((row) => row.partyId)
  const doneKey = done.join()
  useEffect(() => {
    wasDone.current = new Set(doneKey === '' ? [] : doneKey.split(','))
  }, [doneKey])

  const backHere = weekPlanHref(tenantSlug, { semana: weekStart })

  return (
    <>
      <Totalizer
        items={[
          { label: 'Presupuesto', cents: totals.budgetCents },
          { label: 'Pagado', cents: totals.paidCents, tone: 'ok' },
          {
            label: 'Falta pagar',
            cents: totals.remainingCents,
            hint:
              totals.overCents > 0 ? `Te pasaste ${formatCentsShort(totals.overCents)}` : undefined,
          },
        ]}
      />
      <WeekProgress
        percent={totals.percent}
        over={totals.overCents > 0}
        hasBudget={totals.budgetCents > 0}
      />
      <Planilla>
        {visible.length === 0 ? (
          <SheetEmpty>Esta semana no hay deudas, presupuesto ni movimientos.</SheetEmpty>
        ) : (
          <PTable label="Plan de la semana" minWidth={canWrite ? 800 : 680}>
            <thead>
              <tr>
                <PTh>Proveedor</PTh>
                <PTh align="right">Deuda</PTh>
                <PTh align="right">Compró</PTh>
                <PTh align="right">Presupuesto</PTh>
                <PTh align="right">Pagó</PTh>
                <PTh align="right">Falta</PTh>
                {canWrite ? (
                  <PTh>
                    <span className="sr-only">Acciones</span>
                  </PTh>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const owes = row.debtCents > 0
                return (
                  <PRow key={row.partyId}>
                    <PTd className="max-w-[20rem]">
                      <Link
                        href={supplierHref(tenantSlug, row.partyId)}
                        title={row.partyName}
                        className="block truncate rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.partyName}
                      </Link>
                      {paysOnReceipt(row) ? (
                        <span className="block text-xs text-muted-foreground">Paga al recibir</span>
                      ) : null}
                    </PTd>
                    <PTd align="right" className={cn(row.overdueCents > 0 && 'text-destructive')}>
                      <Money cents={row.debtCents} />
                    </PTd>
                    <PTd align="right">
                      <Money cents={row.purchasedCents} />
                    </PTd>
                    <PTd align="right" className="py-0.5">
                      {canWrite ? (
                        <BudgetCell
                          name={row.partyName}
                          cents={row.budgetCents}
                          onSave={(cents) => {
                            void save([{ partyId: row.partyId, amountCents: cents }])
                          }}
                          onMove={(delta) => move(row.partyId, delta)}
                          inputRef={(node) => {
                            if (node) cells.current.set(row.partyId, node)
                            else cells.current.delete(row.partyId)
                          }}
                        />
                      ) : (
                        <Money cents={row.budgetCents} />
                      )}
                    </PTd>
                    <PTd align="right">
                      <Money cents={row.paidCents} />
                    </PTd>
                    <PTd align="right">
                      <LeftCell
                        row={row}
                        thud={wasDone.current !== null && !wasDone.current.has(row.partyId)}
                      />
                    </PTd>
                    {canWrite ? (
                      <PTd className={ROW_ACTIONS_CELL}>
                        <span className={cn('inline-flex', ROW_ACTION)}>
                          {owes ? (
                            <ActionButton
                              action="pagar"
                              params={{ proveedor: row.partyId }}
                              variant="outline"
                              size="sm"
                              className={ROW_BUTTON}
                              aria-label={`Pagarle a ${row.partyName}`}
                            >
                              Pagar
                            </ActionButton>
                          ) : (
                            // Sin deuda no hay nada que cancelar: es la compra pagada en el momento.
                            <Button asChild variant="outline" size="sm" className={ROW_BUTTON}>
                              <Link
                                href={newPurchaseHref(tenantSlug, {
                                  modo: 'pago',
                                  proveedor: row.partyId,
                                  volver: backHere,
                                })}
                                aria-label={`Cargar la compra y el pago de ${row.partyName}`}
                              >
                                Pagar
                              </Link>
                            </Button>
                          )}
                        </span>
                      </PTd>
                    ) : null}
                  </PRow>
                )
              })}
            </tbody>
            <tfoot>
              <PTotalRow>
                <PTd>Total</PTd>
                <PTd align="right">{formatCentsShort(totals.debtCents)}</PTd>
                <PTd align="right">{formatCentsShort(totals.purchasedCents)}</PTd>
                <PTd align="right">{formatCentsShort(totals.budgetCents)}</PTd>
                <PTd align="right">{formatCentsShort(totals.paidCents)}</PTd>
                <PTd align="right">{formatCentsShort(totals.remainingCents)}</PTd>
                {canWrite ? <PTd /> : null}
              </PTotalRow>
            </tfoot>
          </PTable>
        )}
        <PlanillaFoot>
          <div className="flex flex-wrap items-center gap-1.5">
            {canWrite ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={BUTTON}
                  disabled={bulkPending || overdue.length === 0}
                  onClick={bringOverdue}
                >
                  Traer lo vencido
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={BUTTON}
                  disabled={bulkPending}
                  onClick={copyLastWeek}
                >
                  Copiar la semana pasada
                </Button>
                {parties ? (
                  <PartyCombobox
                    aria-label="Agregar un proveedor al plan"
                    value={null}
                    parties={options}
                    placeholder="+ Agregar proveedor"
                    searchPlaceholder="Nombre o CUIT"
                    className="h-10 w-52 text-[13px] md:h-8 md:text-[13px]"
                    onValueChange={(id, party) => {
                      if (!id || !party) return
                      setLayout((current) =>
                        addToPlanLayout(current, {
                          partyId: id,
                          partyName: party.tradeName || party.name,
                        }),
                      )
                      setFocusOn(id)
                    }}
                  />
                ) : null}
              </>
            ) : null}
          </div>
          <Button asChild variant="ghost" size="sm" className={BUTTON}>
            <Link href={monthHref}>Ver el mes</Link>
          </Button>
        </PlanillaFoot>
      </Planilla>
    </>
  )
}
