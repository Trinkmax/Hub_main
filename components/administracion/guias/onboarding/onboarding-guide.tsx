'use client'

import { AlertTriangle, ArrowDown, CircleCheck } from 'lucide-react'
import { useMemo, useOptimistic, useTransition } from 'react'
import { toast } from 'sonner'
import { toastUndo } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Progress } from '@/components/ui/progress'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import {
  minutesText,
  ONBOARDING_HAVE_AT_HAND,
  ONBOARDING_SECTION_HINT,
  ONBOARDING_SECTION_LABEL,
  ONBOARDING_SECTIONS,
  type OnboardingData,
  type OnboardingItemId,
  type OnboardingRow,
  type OnboardingSection,
  type OnboardingState,
  onboardingRows,
  onboardingState,
  sectionProgressText,
} from '@/lib/accounting/onboarding'
import { markOnboardingStep } from '@/lib/imports/actions'
import { cn } from '@/lib/utils'
import { HaveAtHand } from './have-at-hand'
import {
  GUIDE_BUTTON,
  hasPrimaryAction,
  ItemPrimaryAction,
  itemAnchor,
  OnboardingItemRow,
  WhereText,
} from './onboarding-item'
import type { SupplierMessageData } from './supplier-message'

/** Por qué la guía no tiene el estado del bar. */
export type OnboardingGuideProblem =
  /** La base todavía no lo puede dar (falta activar esta parte): la guía va sin marcas. */
  | { kind: 'unavailable' }
  /** Falló la lectura: la página muestra el error con «Reintentar». */
  | { kind: 'error'; message: string }

export type OnboardingGuideProps = {
  slug: string
  /** Lo que devolvió `acc_report_onboarding` (`null`: sin estado, ver `problem`). */
  data: OnboardingData | null
  problem: OnboardingGuideProblem | null
  /** Dueño con acceso de carga. La contadora (y quien solo mira) no ve botones de carga. */
  canWrite: boolean
  supplier: SupplierMessageData
  /** Día de arranque de los libros (`yyyy-MM-dd`), para los saldos iniciales. */
  booksStartDate: string | null
}

type MarkChange = { step: OnboardingItemId; done: boolean }

const NO_MARKS: readonly string[] = []

function applyMarkChange(current: readonly string[], change: MarkChange): readonly string[] {
  const rest = current.filter((step) => step !== change.step)
  return change.done ? [...rest, change.step] : rest
}

/**
 * «Cómo arrancar con Administración» (diseño §5.2): el avance, «Lo próximo
 * que te conviene hacer», «Tené a mano» y los ítems por frecuencia. El estado
 * sale de la base (`acc_report_onboarding`) y se vuelve a calcular acá con
 * las marcas «Ya lo hice» optimistas: se ven al instante y, si la base dice
 * que no, vuelven solas (con el aviso de por qué). Cada marca deja «Deshacer».
 */
export function OnboardingGuide({
  slug,
  data,
  problem,
  canWrite,
  supplier,
  booksStartDate,
}: OnboardingGuideProps) {
  const base = `/${slug}/administracion`
  const [marks, addMark] = useOptimistic(data?.manual ?? NO_MARKS, applyMarkChange)
  const [, startTransition] = useTransition()
  const state = useMemo(() => (data ? onboardingState(data, marks) : null), [data, marks])
  const rows = useMemo(() => onboardingRows(state), [state])
  // Sin estado, «Lo próximo» es por dónde arrancar: el primer ítem de la guía.
  const nextId = state ? state.next : (rows.find((r) => r.status !== 'info')?.id ?? null)
  const nextRow = nextId ? (rows.find((r) => r.id === nextId) ?? null) : null
  const canMark = canWrite && data !== null

  function mark(row: OnboardingRow, done: boolean) {
    startTransition(async () => {
      addMark({ step: row.id, done })
      let result: AccSimpleState<{ step: string; done: boolean }>
      try {
        result = await markOnboardingStep(slug, { step: row.id, done })
      } catch {
        toast.error('Sin conexión: no se guardó la marca. Probá de nuevo.')
        return
      }
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toastUndo(
        done ? `Marcaste «${row.title}» como hecho.` : `«${row.title}» volvió a pendiente.`,
        { id: `arranque-${row.id}`, onUndo: () => mark(row, !done) },
      )
    })
  }

  return (
    <div className="space-y-6">
      <ProgressCard
        state={state}
        nextRow={nextRow}
        guess={state === null}
        problem={problem}
        canWrite={canWrite}
        base={base}
        supplier={supplier}
      />

      <div
        className={cn(
          'grid gap-6',
          canWrite && 'lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start',
        )}
      >
        {canWrite ? (
          <HaveAtHand
            items={ONBOARDING_HAVE_AT_HAND}
            className="lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1"
          />
        ) : null}
        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          {ONBOARDING_SECTIONS.map((section) => (
            <SectionCard
              key={section}
              section={section}
              rows={rows.filter((r) => r.section === section)}
              counts={state ? state.sections[section] : null}
              nextId={nextId}
              base={base}
              canWrite={canWrite}
              canMark={canMark}
              onMark={mark}
              supplier={supplier}
              booksStartDate={booksStartDate}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function SectionCard({
  section,
  rows,
  counts,
  nextId,
  base,
  canWrite,
  canMark,
  onMark,
  supplier,
  booksStartDate,
}: {
  section: OnboardingSection
  rows: OnboardingRow[]
  counts: { done: number; total: number } | null
  nextId: OnboardingItemId | null
  base: string
  canWrite: boolean
  canMark: boolean
  onMark: (row: OnboardingRow, done: boolean) => void
  supplier: SupplierMessageData
  booksStartDate: string | null
}) {
  const titleId = `arranque-${section}-titulo`
  const progress = counts ? sectionProgressText(section, counts) : ''
  return (
    <section
      id={`arranque-${section}`}
      aria-labelledby={titleId}
      className="card-hairline scroll-mt-24 overflow-hidden rounded-xl border bg-card"
    >
      <header className="flex flex-col gap-1 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <h2 id={titleId} className="font-serif text-lg font-semibold tracking-tight">
            {ONBOARDING_SECTION_LABEL[section]}
          </h2>
          <p className="text-xs text-muted-foreground text-pretty">
            {ONBOARDING_SECTION_HINT[section]}
          </p>
        </div>
        {progress ? (
          <p className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {progress}
          </p>
        ) : null}
      </header>
      <ol className="divide-y divide-border/60">
        {rows.map((row, index) => (
          <OnboardingItemRow
            key={row.id}
            row={row}
            n={index + 1}
            isNext={row.id === nextId}
            base={base}
            canWrite={canWrite}
            canMark={canMark}
            onMark={onMark}
            supplier={supplier}
            booksStartDate={booksStartDate}
          />
        ))}
      </ol>
    </section>
  )
}

/** El avance (izquierda) y «Lo próximo que te conviene hacer» (derecha; abajo en el celular). */
function ProgressCard({
  state,
  nextRow,
  guess,
  problem,
  canWrite,
  base,
  supplier,
}: {
  state: OnboardingState | null
  nextRow: OnboardingRow | null
  /** Sin estado de la base: «Lo próximo» es solo por dónde arrancar. */
  guess: boolean
  problem: OnboardingGuideProblem | null
  canWrite: boolean
  base: string
  supplier: SupplierMessageData
}) {
  const percent = state && state.total > 0 ? Math.round((state.done / state.total) * 100) : 0
  const minutes = nextRow ? minutesText(nextRow.minutes) : null
  const eyebrow = guess
    ? 'Por dónde arrancar'
    : canWrite
      ? 'Lo próximo que te conviene hacer'
      : 'Lo próximo que les toca a los dueños'

  return (
    <section
      aria-labelledby="arranque-avance"
      className="card-hairline overflow-hidden rounded-xl border bg-card"
    >
      <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4 p-5">
          <h2 id="arranque-avance" className="font-serif text-lg font-semibold tracking-tight">
            Tu avance
          </h2>
          {state ? (
            <>
              <p className="flex items-baseline gap-2">
                <span className="font-serif text-4xl font-semibold tabular-nums">{state.done}</span>
                <span className="text-sm text-muted-foreground">
                  de {state.total} {state.total === 1 ? 'listo' : 'listos'}
                </span>
              </p>
              <Progress
                value={percent}
                aria-label={`Avance de la guía: ${state.done} de ${state.total} listos`}
              />
              <ul className="grid gap-1.5">
                {ONBOARDING_SECTIONS.map((section) => {
                  const counts = state.sections[section]
                  if (counts.total === 0) return null
                  return (
                    <li key={section} className="flex items-center justify-between gap-3 text-sm">
                      <a
                        href={`#arranque-${section}`}
                        className="inline-flex min-h-11 min-w-0 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline md:min-h-0"
                      >
                        {ONBOARDING_SECTION_LABEL[section]}
                      </a>
                      <span className="shrink-0 text-xs font-medium tabular-nums">
                        {sectionProgressText(section, counts)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : problem?.kind === 'error' ? (
            <p className="text-sm text-muted-foreground text-pretty">
              No pudimos ver tu avance. Igual podés seguir la guía paso a paso.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground text-pretty">
              Todavía no podemos marcar tu avance solos: estamos terminando de activar esta parte.
              Mientras tanto, usá la guía como lista.
            </p>
          )}
        </div>

        <div className="space-y-3 border-t border-border/60 p-5 lg:border-t-0 lg:border-l">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            {nextRow ? eyebrow : 'Lo próximo'}
          </p>
          {nextRow ? (
            <>
              <h3 className="font-serif text-xl font-semibold tracking-tight text-balance">
                {nextRow.title}
              </h3>
              <p className="text-sm text-muted-foreground text-pretty">{nextRow.what}</p>
              <p className="text-sm text-pretty">
                <span className="font-medium">Dónde: </span>
                <WhereText row={nextRow} base={base} />
                {minutes ? <span className="text-muted-foreground"> · {minutes}</span> : null}
              </p>
              {nextRow.pending ? (
                <p className="flex items-start gap-1.5 text-sm text-warning-text text-pretty">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {nextRow.pending}
                </p>
              ) : null}
              <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
                {canWrite ? <NextAction row={nextRow} base={base} supplier={supplier} /> : null}
                <Button asChild variant="outline" className={GUIDE_BUTTON}>
                  <a href={`#${itemAnchor(nextRow.id)}`}>
                    Ver cómo se hace
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-start gap-3">
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-medium">Está todo al día.</p>
                <p className="text-sm text-muted-foreground text-pretty">
                  Seguí con lo de cada semana y cada mes: cuando algo te toque, te avisamos en el
                  Resumen.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** El botón de «Lo próximo»: el mismo del ítem, o copiar el mensaje para los proveedores. */
function NextAction({
  row,
  base,
  supplier,
}: {
  row: OnboardingRow
  base: string
  supplier: SupplierMessageData
}) {
  if (row.id === 'suppliers_message') {
    return supplier.status === 'ready' ? (
      <CopyButton
        value={supplier.message}
        label="Copiar el mensaje"
        variant="default"
        className={GUIDE_BUTTON}
      />
    ) : null
  }
  if (!hasPrimaryAction(row)) return null
  return <ItemPrimaryAction row={row} base={base} variant="default" />
}
