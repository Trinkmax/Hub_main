'use client'

import { ClipboardPaste } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { suggestAccount } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/bulk'
import {
  gastosFijosHref,
  recurringHref,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import {
  isRecurringFrequency,
  nthDue,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/recurring'
import { InstallmentsField } from '@/app/(manager)/[tenantSlug]/administracion/compras/gastos-fijos/[id]/_components/installments-field'
import {
  type InstallmentsDraft,
  installmentsValues,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/gastos-fijos/[id]/_lib/form-payload'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { Meter } from '@/components/administracion/charts/meter'
import { type CategoryOption, CategoryPicker, MoneyHero } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import { cn } from '@/lib/utils'
import { RowQuickEdit } from '../../_components/row-quick-edit'
import { SaveMark } from '../../_components/save-mark'
import { useRowEdit } from '../../_components/use-row-actions'
import type { PasteMatch } from '../../_lib/paste-amounts'
import { detectInstallment } from '../../_lib/planilla-words'
import { PasteAmountsDialog } from './paste-amounts-dialog'

/**
 * «Completar la planilla»: la planilla en lápiz. Todos los gastos fijos a la
 * vista, dos campos por renglón (cuánto y qué día vence) y nada más: cada
 * renglón se guarda solo, con Enter o al salir de él. Es para cargar los
 * montos de un bar que recién arranca y, una vez por año, para «subió todo».
 *
 * - Es plana (sin agrupar por día) porque acá el día se está cambiando.
 * - Orden fijo: guardar no reordena ni saca renglones de la vista (el filtro se
 *   aplicó al entrar).
 * - Enter guarda ese renglón y baja al monto del siguiente. NUNCA sale de la
 *   pantalla ni guarda otra cosa (lección del 12/10).
 * - «Pegar los montos» completa los campos sin guardar: se revisan y se
 *   guardan de a uno, en orden.
 *
 * Cada guardado es `saveRecurringExpense` con el paquete de una edición del
 * renglón (`useRowEdit`): lo mismo que manda la planilla.
 */

export type FillView = 'sin-monto' | 'todos' | 'varios'

type RowHandle = {
  focusAmount: () => void
  commit: () => Promise<boolean>
}

type RowStatus = { pasted: boolean; saving: boolean }

const LINK =
  'cursor-pointer rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring'
const CHIP =
  'inline-flex min-h-9 cursor-pointer items-center rounded-full border border-dashed border-foreground/30 px-3 text-xs font-medium text-muted-foreground outline-none hover:border-foreground/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11'

function matchesView(
  row: RecurringExpenseRow,
  view: FillView,
  miscAccountId: string | null,
): boolean {
  if (view === 'sin-monto') return row.amountCents === null
  if (view === 'varios') return miscAccountId !== null && row.accountId === miscAccountId
  return true
}

export function FillSheet({
  tenantSlug,
  rows,
  view,
  focusId,
  miscAccountId,
  categories,
  accounts,
  pills,
}: {
  tenantSlug: string
  /** Todos los gastos fijos activos, en el orden de entrada (vencimiento y nombre). */
  rows: readonly RecurringExpenseRow[]
  view: FillView
  /** `?foco=<uuid>`: el renglón que entra con el cursor puesto. */
  focusId: string | null
  miscAccountId: string | null
  categories: readonly CategoryOption[]
  accounts: readonly AccountOption[]
  /** Las píldoras de vista (links), ya armadas en el server. */
  pills: ReactNode
}) {
  const router = useRouter()
  // El filtro se aplica al entrar: lo que se completa no se va de la vista.
  const [visible, setVisible] = useState<readonly string[]>(() => {
    const ids = rows.filter((row) => matchesView(row, view, miscAccountId)).map((row) => row.id)
    return focusId && !ids.includes(focusId) && rows.some((row) => row.id === focusId)
      ? [focusId, ...ids]
      : ids
  })
  const [status, setStatus] = useState<Readonly<Record<string, RowStatus>>>({})
  const [pasteOpen, setPasteOpen] = useState(false)
  const [paste, setPaste] = useState<{ nonce: number; byId: ReadonlyMap<string, PasteMatch> }>({
    nonce: 0,
    byId: new Map(),
  })
  const [discard, setDiscard] = useState(0)
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)
  const [leaving, setLeaving] = useState(false)
  const handles = useRef(new Map<string, RowHandle>())

  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])
  const shown = visible.flatMap((id) => {
    const row = byId.get(id)
    return row ? [row] : []
  })
  const withAmount = rows.filter((row) => row.amountCents !== null)
  const missing = rows.length - withAmount.length
  const sumCents = withAmount.reduce((sum, row) => sum + (row.amountCents ?? 0), 0)
  const pastedIds = shown.filter((row) => status[row.id]?.pasted).map((row) => row.id)
  const firstBlank = shown.find((row) => row.amountCents === null && row.breakdown.length === 0)

  const onHandle = useCallback((id: string, handle: RowHandle | null) => {
    if (handle) handles.current.set(id, handle)
    else handles.current.delete(id)
  }, [])
  const onStatus = useCallback((id: string, next: RowStatus) => {
    setStatus((prev) => {
      const before = prev[id]
      if (before && before.pasted === next.pasted && before.saving === next.saving) return prev
      return { ...prev, [id]: next }
    })
  }, [])

  // Enter: al monto del renglón de abajo. En el último, el cursor se queda.
  const focusNext = (id: string) => {
    const index = visible.indexOf(id)
    const next = visible.slice(index + 1).find((candidate) => handles.current.has(candidate))
    if (next) handles.current.get(next)?.focusAmount()
  }

  // Al entrar: el cursor en el renglón pedido o en el primero.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al montar
  useEffect(() => {
    const asked = focusId !== null && handles.current.has(focusId)
    // En el teléfono el foco solo abriría el teclado arriba de todo: se entra mirando.
    if (!asked && !window.matchMedia('(pointer: fine)').matches) return
    const target = asked ? focusId : visible[0]
    if (target) handles.current.get(target)?.focusAmount()
  }, [])

  const applyPaste = (matches: PasteMatch[]) => {
    const map = new Map(matches.map((match) => [match.id, match]))
    // Lo pegado puede traer renglones que este filtro no mostraba: se suman a la vista.
    setVisible((prev) => {
      const extra = rows.map((row) => row.id).filter((id) => map.has(id) && !prev.includes(id))
      return extra.length > 0 ? [...prev, ...extra] : prev
    })
    setPaste((prev) => ({ nonce: prev.nonce + 1, byId: map }))
  }

  const saveAllPasted = async () => {
    const ids = pastedIds
    setBulk({ done: 0, total: ids.length })
    for (const [index, id] of ids.entries()) {
      // De a uno y en orden: si uno falla queda marcado y sigue el resto.
      await handles.current.get(id)?.commit()
      setBulk({ done: index + 1, total: ids.length })
    }
    setBulk(null)
  }

  const finish = async () => {
    setLeaving(true)
    // Espera lo que se esté guardando (y guarda lo que quedó escrito sin salir del campo).
    const results = await Promise.all(
      [...handles.current.values()].map((handle) => handle.commit()),
    )
    // Si alguno no se guardó, no se sale: queda marcado en su renglón.
    if (results.includes(false)) {
      setLeaving(false)
      return
    }
    router.push(gastosFijosHref(tenantSlug))
  }

  return (
    <div className="space-y-5">
      {/* La tira queda a la vista mientras se cargan los renglones (desde `sm`; en el celular
          ocuparía media pantalla). El pegajoso va en el envoltorio: `card-hairline` posiciona. */}
      <div className="z-20 sm:sticky sm:top-16">
        <div className="card-hairline flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border bg-card/95 p-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:px-5">
          <div className="flex min-w-0 flex-1 basis-72 flex-wrap items-end gap-x-6 gap-y-3">
            <MoneyHero
              size="md"
              animate
              cents={withAmount.length === 0 ? null : sumCents}
              label="Suman los que ya tienen monto"
            />
            <div className="min-w-40 flex-1 space-y-1.5 pb-1">
              <Meter
                valueCents={withAmount.length}
                totalCents={rows.length}
                ariaLabel={`${withAmount.length} de ${rows.length} con monto`}
              />
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">
                  {withAmount.length} de {rows.length}
                </span>{' '}
                con monto
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 rounded-full"
            onClick={() => setPasteOpen(true)}
          >
            <ClipboardPaste aria-hidden className="size-4" />
            Pegar los montos desde mi planilla
          </Button>
        </div>
      </div>

      {pills}

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card/50 p-6 text-sm text-muted-foreground">
          {view === 'sin-monto'
            ? 'Todos tienen monto.'
            : view === 'varios'
              ? 'Ninguno quedó en «Gastos varios».'
              : 'No hay gastos fijos activos.'}
        </p>
      ) : (
        <ul
          aria-label="Gastos fijos para completar"
          className="card-hairline rounded-2xl border bg-card shadow-xs"
        >
          {shown.map((row) => (
            <FillRow
              key={row.id}
              row={row}
              tenantSlug={tenantSlug}
              isMisc={miscAccountId !== null && row.accountId === miscAccountId}
              categories={categories}
              accounts={accounts}
              paste={paste.byId.get(row.id) ?? null}
              pasteNonce={paste.nonce}
              discardNonce={discard}
              hint={
                row.id === firstBlank?.id
                  ? 'Si cambia todos los meses (la luz, los impuestos), poné lo que pagaste la última vez: al pagar, la planilla te pregunta si era eso.'
                  : null
              }
              onHandle={onHandle}
              onStatus={onStatus}
              onNext={focusNext}
            />
          ))}
        </ul>
      )}

      {/* El pie: en el celular, una banda pegada abajo de borde a borde. Desde `sm` es una barra
          del ancho de la planilla, con sus esquinas: una banda que sobresale de la columna y se
          corta en seco flota rara cuando la lista es corta y la pantalla, ancha. */}
      <div
        className={cn(
          'sticky bottom-0 z-30 -mx-4 border-t border-border/70 bg-background/90 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] shadow-[0_-10px_24px_-16px_rgb(0_0_0/0.35)] backdrop-blur-md',
          'sm:bottom-4 sm:mx-0 sm:rounded-2xl sm:border sm:bg-card/95 sm:px-5 sm:pt-3 sm:pb-3 sm:shadow-md',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {pastedIds.length > 0 || bulk ? (
            <>
              <p aria-live="polite" className="min-w-0 flex-1 basis-56 text-sm text-pretty">
                {bulk ? (
                  `Guardando ${Math.min(bulk.done + 1, bulk.total)} de ${bulk.total}…`
                ) : (
                  <>
                    Completé{' '}
                    {pastedIds.length === 1 ? '1 renglón' : `${pastedIds.length} renglones`} con lo
                    que pegaste. Revisalos.{' '}
                    <button type="button" onClick={() => setDiscard((n) => n + 1)} className={LINK}>
                      Descartar lo pegado
                    </button>
                  </>
                )}
              </p>
              <Button
                type="button"
                className="h-12 w-full rounded-xl px-6 text-base sm:w-auto"
                disabled={bulk !== null}
                onClick={() => void saveAllPasted()}
              >
                {pastedIds.length === 1 ? 'Guardar 1' : `Guardar los ${pastedIds.length}`}
              </Button>
            </>
          ) : (
            <>
              <p aria-live="polite" className="min-w-0 flex-1 basis-40 text-sm">
                {missing === 0
                  ? 'Todos tienen monto.'
                  : missing === 1
                    ? 'Falta 1 sin monto.'
                    : `Faltan ${missing} sin monto.`}
              </p>
              <Button
                type="button"
                className="h-12 w-full rounded-xl px-6 text-base sm:w-auto"
                disabled={leaving}
                onClick={() => void finish()}
              >
                {leaving ? 'Guardando…' : 'Listo: volver a la planilla'}
              </Button>
            </>
          )}
        </div>
      </div>

      <PasteAmountsDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        rows={rows}
        onApply={applyPaste}
      />
    </div>
  )
}

function FillRow({
  row,
  tenantSlug,
  isMisc,
  categories,
  accounts,
  paste,
  pasteNonce,
  discardNonce,
  hint,
  onHandle,
  onStatus,
  onNext,
}: {
  row: RecurringExpenseRow
  tenantSlug: string
  isMisc: boolean
  categories: readonly CategoryOption[]
  accounts: readonly AccountOption[]
  /** Lo que trajo «Pegar los montos» para este renglón. */
  paste: PasteMatch | null
  pasteNonce: number
  discardNonce: number
  hint: string | null
  onHandle: (id: string, handle: RowHandle | null) => void
  onStatus: (id: string, status: RowStatus) => void
  onNext: (id: string) => void
}) {
  const edit = useRowEdit(tenantSlug, row)
  const amountRef = useRef<HTMLInputElement>(null)
  const [panel, setPanel] = useState<'cuotas' | 'categoria' | null>(null)
  const [fullPlan, setFullPlan] = useState(false)
  const detected = useMemo(() => detectInstallment(edit.base.name), [edit.base.name])
  const [cuotas, setCuotas] = useState<InstallmentsDraft>(() => ({
    mode: 'total',
    total: detected?.total ?? null,
    current: detected?.current ?? null,
  }))
  const [cleanName, setCleanName] = useState(true)
  const fichaHref = recurringHref(tenantSlug, row.id)
  const failure = edit.mark.failure
  const detailed = row.breakdown.length > 0
  const { commit, fill, revert, pasted, saving } = edit

  useEffect(() => {
    onHandle(row.id, { focusAmount: () => amountRef.current?.focus(), commit })
    return () => onHandle(row.id, null)
  }, [row.id, commit, onHandle])
  useEffect(() => {
    onStatus(row.id, { pasted, saving })
  }, [row.id, pasted, saving, onStatus])

  // Llegó un pegado nuevo: se completan los campos, sin guardar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: una vez por pegado
  useEffect(() => {
    if (pasteNonce > 0 && paste && !detailed)
      fill({ amountCents: paste.amountCents, day: paste.day })
  }, [pasteNonce])
  // «Descartar lo pegado»: vuelve a lo último guardado.
  // biome-ignore lint/correctness/useExhaustiveDependencies: una vez por descarte
  useEffect(() => {
    if (discardNonce > 0 && pasted) revert()
  }, [discardNonce])

  const frequency = isRecurringFrequency(row.frequency) ? row.frequency : 'monthly'
  const showCuotasChip = detected !== null && row.endsOn === null && row.remainingDues === null
  const saveCuotas = async () => {
    const { dues, installmentsTotal } = installmentsValues(cuotas)
    if (dues === null || dues < 1) return
    const ok = await edit.save({
      endsOn: nthDue(edit.base.nextDueDate, edit.base.dueDay, frequency, dues),
      installmentsTotal,
      ...(cleanName && detected?.cleanName ? { name: detected.cleanName } : {}),
    })
    if (ok) setPanel(null)
  }
  const cuotasValues = installmentsValues(cuotas)
  const account = accounts.find((a) => a.id === edit.base.accountId) ?? null
  const suggestedId = useMemo(
    () => (isMisc ? suggestAccount(edit.base.name, categories) : null),
    [isMisc, edit.base.name, categories],
  )
  const categoryName = account?.name ?? row.accountName

  return (
    <li
      id={`gasto-${row.id}`}
      className="scroll-mt-40 border-b border-border/60 px-3 py-3.5 last:border-b-0 sm:px-5"
    >
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <p className="font-medium leading-snug [overflow-wrap:anywhere]">{edit.base.name}</p>
          {categoryName && !(isMisc && panel === null) ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{categoryName}</p>
          ) : null}
        </div>
        <div className="sm:row-span-2">
          <RowQuickEdit
            idPrefix={`completar-${row.id}`}
            name={row.name}
            amountLabel="¿Cuánto?"
            amountCents={edit.amountCents}
            onAmountChange={edit.setAmountCents}
            dueDay={edit.dueDay}
            onDueDayChange={edit.setDueDay}
            detailTotalCents={detailed ? row.amountCents : null}
            fichaHref={fichaHref}
            onCommit={() => {
              void edit.commit()
              onNext(row.id)
            }}
            onLeave={() => void edit.commit()}
            onRevert={edit.revert}
            amountRef={amountRef}
            highlighted={edit.pasted}
            enterKeyHint="next"
            mark={
              <SaveMark
                persist
                state={edit.mark.state}
                message={failure?.message}
                onRetry={
                  failure?.kind === 'stale'
                    ? () => window.location.reload()
                    : failure?.kind === 'other'
                      ? () => void edit.commit()
                      : undefined
                }
                retryLabel={failure?.kind === 'stale' ? 'Recargar' : 'Reintentar'}
                className="sm:w-28"
              />
            }
          />
          {failure?.kind === 'category' ? (
            <Link href={fichaHref} className={cn(LINK, 'mt-1 inline-block text-xs')}>
              Cambiarla en la ficha
            </Link>
          ) : null}
        </div>
        {(showCuotasChip || isMisc) && panel === null ? (
          <div className="flex flex-wrap gap-2">
            {showCuotasChip && detected ? (
              <button type="button" onClick={() => setPanel('cuotas')} className={CHIP}>
                ¿Es la cuota {detected.current} de {detected.total}?
              </button>
            ) : null}
            {isMisc ? (
              <button type="button" onClick={() => setPanel('categoria')} className={CHIP}>
                Gastos varios · cambiar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {hint ? <p className="mt-2.5 text-xs text-muted-foreground text-pretty">{hint}</p> : null}

      {panel === 'cuotas' && detected ? (
        <div className="mt-3 grid gap-3 rounded-xl bg-secondary/50 p-3.5">
          <InstallmentsField
            idPrefix={`completar-${row.id}-cuotas`}
            toggle={false}
            draft={cuotas}
            onChange={(next) => setCuotas(next.mode === 'none' ? cuotas : next)}
            nextDueDate={edit.base.nextDueDate}
            dueDay={edit.base.dueDay}
            frequency={frequency}
            suggested={detected}
          />
          {detected.cleanName ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={cleanName}
                onChange={(event) => setCleanName(event.target.checked)}
                className="size-4 shrink-0 accent-(--primary) outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="text-pretty">
                Sacar «{detected.current}/{detected.total}» del nombre (la cuota la lleva la
                planilla)
              </span>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-11 rounded-full px-5"
              disabled={edit.saving || cuotasValues.dues === null || cuotasValues.dues < 1}
              onClick={() => void saveCuotas()}
            >
              Guardar las cuotas
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 rounded-full px-4"
              onClick={() => setPanel(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {panel === 'categoria' ? (
        <div className="mt-3 grid gap-3 rounded-xl bg-secondary/50 p-3.5">
          <p id={`completar-${row.id}-categoria`} className="text-sm font-medium">
            ¿En qué se gasta?
          </p>
          <CategoryPicker
            aria-labelledby={`completar-${row.id}-categoria`}
            options={categories}
            value={edit.base.accountId}
            suggestedId={suggestedId}
            outside={account ? { id: account.id, name: account.name } : null}
            onOpenFullPlan={() => setFullPlan(true)}
            onChange={(next) => {
              // Tocar la elegida la «saca»: un gasto fijo no puede quedar sin categoría.
              if (next === null || next === edit.base.accountId) return
              void edit.save({ accountId: next }).then((ok) => {
                if (ok) setPanel(null)
              })
            }}
          />
          {fullPlan ? (
            <AccountCombobox
              value={edit.base.accountId}
              onValueChange={(next) => {
                if (next === null || next === edit.base.accountId) return
                void edit.save({ accountId: next }).then((ok) => {
                  if (ok) setPanel(null)
                })
              }}
              accounts={accounts}
              placeholder="Buscá en el plan completo"
              aria-label={`Categoría de ${row.name}, en el plan completo`}
            />
          ) : null}
          <div>
            <Button
              type="button"
              variant="ghost"
              className="h-11 rounded-full px-4"
              onClick={() => setPanel(null)}
            >
              Cerrar
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
