'use client'

import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useOptimistic, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Planilla, PlanillaTitle, PTable, PTh } from '@/components/administracion/planilla'
import { toastUndo } from '@/components/administracion/quick-actions'
import { Progress } from '@/components/ui/progress'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import {
  ONBOARDING_HAVE_AT_HAND,
  ONBOARDING_SECTION_LABEL,
  ONBOARDING_SECTIONS,
  type OnboardingData,
  type OnboardingItemId,
  type OnboardingRow,
  type OnboardingSection,
  onboardingRows,
  onboardingState,
  sectionProgressText,
} from '@/lib/accounting/onboarding'
import { markOnboardingStep } from '@/lib/imports/actions'
import { HaveAtHand } from './have-at-hand'
import { OnboardingItemRow } from './onboarding-item'
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

/** Lo que se abre con un link a la rutina: sus secciones y sus pasos. */
const ROUTINE_TARGETS: ReadonlySet<string> = new Set([
  'daily',
  'weekly',
  'monthly',
  ...onboardingRows(null)
    .filter((row) => row.section !== 'day1')
    .map((row) => row.id),
])

function applyMarkChange(current: readonly string[], change: MarkChange): readonly string[] {
  const rest = current.filter((step) => step !== change.step)
  return change.done ? [...rest, change.step] : rest
}

/**
 * La Puesta en marcha: la barra de avance y una planilla Estado · Paso · [Ir] (lo de una sola vez),
 * con el detalle de cada paso plegado. Debajo, plegada mientras falte arrancar, la rutina de cada
 * día, semana y mes, y lo que conviene tener a mano. El estado sale de la base (`acc_report_onboarding`) y se vuelve a calcular
 * acá con las marcas «Ya lo hice» optimistas: se ven al instante y, si la base dice que no, vuelven
 * solas (con el aviso de por qué). Cada marca deja «Deshacer».
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
  const canMark = canWrite && data !== null
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const setup = state ? state.sections.day1 : { done: 0, total: 0 }
  // Mientras falte arrancar, una sola lista: la rutina espera plegada.
  const [routineOpen, setRoutineOpen] = useState(setup.total > 0 && setup.done === setup.total)

  const toggle = (id: string) =>
    setOpened((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Quien llega con `#arranque-<paso>` ve ese paso abierto, aunque ya esté hecho.
  useEffect(() => {
    const openFromHash = () => {
      const id = window.location.hash.slice(1)
      if (!id.startsWith('arranque-')) return
      const step = id.slice('arranque-'.length)
      if (ROUTINE_TARGETS.has(step)) setRoutineOpen(true)
      setOpened((prev) => (prev.has(step) ? prev : new Set(prev).add(step)))
      // La fila estaba oculta: el navegador no pudo bajar hasta ella.
      requestAnimationFrame(() =>
        document.getElementById(`${id}-titulo`)?.scrollIntoView({ block: 'start' }),
      )
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => window.removeEventListener('hashchange', openFromHash)
  }, [])

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

  const percent = setup.total > 0 ? Math.round((setup.done / setup.total) * 100) : 0
  const sheet = (section: OnboardingSection) => (
    <SectionSheet
      key={section}
      section={section}
      rows={rows.filter((r) => r.section === section)}
      counts={state ? state.sections[section] : null}
      nextId={nextId}
      opened={opened}
      onToggle={toggle}
      base={base}
      canWrite={canWrite}
      canMark={canMark}
      onMark={mark}
      supplier={supplier}
      booksStartDate={booksStartDate}
    />
  )

  return (
    <div className="grid gap-3.5">
      {state ? (
        <div className="grid gap-1.5">
          <Progress
            value={percent}
            aria-label={`Puesta en marcha: ${setup.done} de ${setup.total} listos`}
          />
          <p className="text-xs tabular-nums text-muted-foreground">
            {setup.done} de {setup.total} {setup.total === 1 ? 'listo' : 'listos'}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-pretty">
          {problem?.kind === 'error'
            ? 'No pudimos ver tu avance. Igual podés seguir la lista paso a paso.'
            : 'Todavía no podemos marcar tu avance solos: usá esto como lista.'}
        </p>
      )}

      {sheet('day1')}

      <details
        open={routineOpen}
        onToggle={(event) => setRoutineOpen(event.currentTarget.open)}
        className="group/routine"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          Tu rutina: cada día, cada semana y cada mes
          <ChevronDown
            aria-hidden
            className="size-4 text-muted-foreground transition-transform group-open/routine:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="grid gap-3.5 pt-3.5">
          {ONBOARDING_SECTIONS.filter((section) => section !== 'day1').map(sheet)}
        </div>
      </details>

      {canWrite ? <HaveAtHand items={ONBOARDING_HAVE_AT_HAND} /> : null}
    </div>
  )
}

/** Una planilla: la de la puesta en marcha, o la de la rutina de cada día, semana o mes. */
function SectionSheet({
  section,
  rows,
  counts,
  nextId,
  opened,
  onToggle,
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
  opened: ReadonlySet<string>
  onToggle: (id: string) => void
  base: string
  canWrite: boolean
  canMark: boolean
  onMark: (row: OnboardingRow, done: boolean) => void
  supplier: SupplierMessageData
  booksStartDate: string | null
}) {
  const progress = counts && section !== 'day1' ? sectionProgressText(section, counts) : ''
  return (
    <section id={`arranque-${section}`} className="scroll-mt-24">
      <Planilla>
        <PlanillaTitle
          title={ONBOARDING_SECTION_LABEL[section]}
          actions={
            progress ? (
              <span className="text-xs tabular-nums text-muted-foreground">{progress}</span>
            ) : undefined
          }
        />
        <PTable label={ONBOARDING_SECTION_LABEL[section]} minWidth={420}>
          <thead>
            <tr>
              <PTh>Estado</PTh>
              <PTh>Paso</PTh>
              <PTh>
                <span className="sr-only">Ir</span>
              </PTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <OnboardingItemRow
                key={row.id}
                row={row}
                isNext={row.id === nextId}
                open={opened.has(row.id)}
                onToggle={onToggle}
                base={base}
                canWrite={canWrite}
                canMark={canMark}
                onMark={onMark}
                supplier={supplier}
                booksStartDate={booksStartDate}
              />
            ))}
          </tbody>
        </PTable>
      </Planilla>
    </section>
  )
}
