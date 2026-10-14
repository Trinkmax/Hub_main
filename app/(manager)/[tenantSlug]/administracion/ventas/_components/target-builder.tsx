'use client'

import { Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { BIG_MONEY_FIELD } from '@/components/administracion/acciones/sheet-parts'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { handleFormKeyDown } from '@/components/administracion/cajas-ventas/form-keys'
import { compactCents } from '@/components/administracion/charts/scale'
import { Pill, StepCard } from '@/components/administracion/kit'
import { MoneyField } from '@/components/administracion/money-input'
import { NavDialog } from '@/components/administracion/nav/nav-dialog'
import { toastUndo } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import { saveSalesTargets } from '@/lib/accounting/actions/projection'
import { MAX_CENTS } from '@/lib/accounting/schemas'
import { capitalizeFirst, WEEKDAY_NAMES, WEEKDAY_NAMES_SHORT } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { useMasterAction } from '../../ajustes/_components/use-master-action'
import { cellMillions, longDayTitle } from '../_lib/almanac'
import {
  type BuiltTarget,
  buildTargets,
  DEFAULT_WEEK_PLAN,
  LEVEL_LABELS,
  paceHint,
  TARGET_LEVELS,
  type TargetLevel,
  WEEK_ORDER,
  type WeekPlan,
} from '../_lib/target-builder'
import { MonthGrid, type MonthGridCell } from './month-grid'

/**
 * «Armar el objetivo»: el camino guiado para el bar que no tiene su planilla
 * (quien la tiene usa «Cargar una lista», que no cambió). Tres pasos a la
 * vista: cuánto querés vender en el mes, qué días son fuertes, y cómo queda
 * repartido día por día antes de guardar. En la compu, «Mirá cómo queda» va
 * fijo a la derecha: al tocar «Flojo / Normal / Fuerte» se ve cambiar el mes.
 *
 * Guarda con lo mismo de siempre: `saveSalesTargets(slug, { items })`, un ítem
 * por día (sin tocar las notas), por `useMasterAction`. Después de guardar se
 * puede deshacer durante 6 segundos: vuelve a guardar los objetivos que había.
 */
export function TargetBuilder({
  month,
  monthName,
  averageCents,
  existing,
  label,
  variant = 'quiet',
}: {
  /** `yyyy-MM`. */
  month: string
  /** «octubre». */
  monthName: string
  /** Lo vendido por noche cargada (`monthPace().averageCents`); `null` sin cierres. */
  averageCents: number | null
  /** Los objetivos que ya tiene cada día del mes: lo que «Deshacer» vuelve a poner. */
  existing: readonly BuiltTarget[]
  /** «Armar el objetivo» / «Armar de nuevo». */
  label: string
  variant?: 'quiet' | 'link'
}) {
  const { tenantSlug } = useAccounting()
  const { pending, run } = useMasterAction()
  const [open, setOpen] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [plan, setPlan] = useState<WeekPlan>(DEFAULT_WEEK_PLAN)
  const [error, setError] = useState<string | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  // Con mouse y teclado, se abre listo para escribir el total. En el teléfono no: el teclado
  // taparía los pasos antes de leerlos.
  useEffect(() => {
    if (!open || !window.matchMedia('(pointer: fine)').matches) return
    const frame = requestAnimationFrame(() => amountRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  const built = useMemo(
    () => buildTargets({ month, totalCents: total, plan }),
    [month, total, plan],
  )
  const already = existing.filter((item) => item.targetCents !== null).length
  const ready = built.days > 0
  const hint = paceHint({ averageCents, month })

  const cells = useMemo(
    (): MonthGridCell[] =>
      built.items.map((item) => ({
        date: item.day,
        state: 'future',
        valueShort: item.targetCents === null ? null : cellMillions(item.targetCents),
        label: `${longDayTitle(item.day)}: ${
          item.targetCents === null ? 'sin objetivo' : formatCentsShort(item.targetCents)
        }`,
      })),
    [built.items],
  )

  const save = () => {
    setError(null)
    if (!ready) {
      setError('Escribí cuánto querés vender en el mes.')
      return
    }
    const previous = existing.map((item) => ({ day: item.day, targetCents: item.targetCents }))
    run(() => saveSalesTargets(tenantSlug, { items: built.items }), {
      quiet: true,
      onSuccess: () => {
        setOpen(false)
        setTotal(null)
        toastUndo(`Objetivo de ${monthName} guardado · ${formatCentsShort(built.totalCents)}`, {
          onUndo: () => {
            if (previous.length === 0) return
            run(() => saveSalesTargets(tenantSlug, { items: previous }), {
              quiet: true,
              onSuccess: () => toast.success('Listo: volvieron los objetivos de antes.'),
            })
          },
        })
      },
      onFailure: (state) => setError(state.message),
    })
  }

  return (
    <>
      {variant === 'link' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wand2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {label}
        </button>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-2 md:pointer-fine:h-9"
          onClick={() => setOpen(true)}
        >
          <Wand2 aria-hidden className="size-4" />
          {label}
        </Button>
      )}
      <NavDialog
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
        title={`Armar el objetivo de ${monthName}`}
        description="Decís cuánto querés vender y qué días son fuertes, y queda repartido día por día."
        size="lg"
      >
        <form
          className="grid gap-3 px-1 pb-2 lg:grid-cols-[minmax(0,1fr)_19.5rem] lg:items-start"
          // Enter en el total NO guarda (pisaría el objetivo del mes sin haber mirado los pasos
          // 2 y 3): guarda el botón del final, o ⌘↵ / Ctrl↵.
          onKeyDown={handleFormKeyDown}
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <div className="grid min-w-0 gap-3">
            <StepCard
              open
              n={1}
              state={total !== null && total > 0 ? 'done' : 'current'}
              title={`¿Cuánto querés vender en ${monthName}?`}
              summary="Es la venta de todo el mes, ya sin las comisiones."
            >
              <MoneyField
                label={`Objetivo de ${monthName}`}
                fieldClassName="[&>label]:sr-only"
                className={BIG_MONEY_FIELD}
                decimals="auto"
                inputRef={amountRef}
                value={total}
                maxCents={MAX_CENTS}
                onValueChange={(cents) => {
                  setTotal(cents)
                  setError(null)
                }}
                hint={hint ?? undefined}
              />
            </StepCard>

            <StepCard
              open
              n={2}
              state={ready ? 'done' : 'todo'}
              title="¿Qué días son más fuertes?"
              summary="Un día fuerte se lleva más objetivo que uno flojo. Si un día no abrís, marcalo cerrado."
            >
              <ul className="grid gap-2">
                {WEEK_ORDER.map((weekday) => {
                  const name = capitalizeFirst(WEEKDAY_NAMES[weekday] ?? '')
                  const short = capitalizeFirst(WEEKDAY_NAMES_SHORT[weekday] ?? '')
                  return (
                    <li
                      key={weekday}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5"
                    >
                      <span id={`dia-${weekday}`} className="w-24 text-sm font-medium lg:w-10">
                        {/* En la compu la columna es angosta: «Lun». El nombre entero se sigue leyendo. */}
                        <span className="lg:sr-only">{name}</span>
                        <span aria-hidden className="max-lg:hidden">
                          {short}
                        </span>
                      </span>
                      {/* biome-ignore lint/a11y/useSemanticElements: un grupo de píldoras que se aprietan (aria-pressed), no un fieldset de radios */}
                      <span
                        role="group"
                        aria-labelledby={`dia-${weekday}`}
                        // En el celular las cuatro van en un renglón parejo (sueltas, «Fuerte» bajaba sola).
                        className="grid w-full grid-cols-4 gap-1.5 sm:flex sm:w-auto sm:flex-wrap"
                      >
                        {TARGET_LEVELS.map((level: TargetLevel) => (
                          <Pill
                            key={level}
                            size="touch"
                            className="max-sm:w-full max-sm:justify-center max-sm:px-1 md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]"
                            active={(plan[weekday] ?? 'normal') === level}
                            onClick={() => setPlan((prev) => ({ ...prev, [weekday]: level }))}
                          >
                            {LEVEL_LABELS[level]}
                          </Pill>
                        ))}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </StepCard>
          </div>

          <StepCard
            open
            n={3}
            className="min-w-0 lg:sticky lg:top-0"
            state={ready ? 'current' : 'todo'}
            title="Mirá cómo queda"
            summary={
              ready
                ? `${built.days} ${built.days === 1 ? 'día' : 'días'} · ${formatCentsShort(built.totalCents)} · el día más fuerte, ${compactCents(
                    Math.max(...built.items.map((item) => item.targetCents ?? 0)),
                  )}`
                : 'Escribí el total del mes y acá ves el objetivo de cada día.'
            }
          >
            <MonthGrid
              month={month}
              cells={cells}
              size="compact"
              caption={`El objetivo de cada día de ${monthName}`}
            />
            {already > 0 ? (
              <p className="mt-3 text-sm text-warning-text text-pretty">
                Ya hay objetivo en {already} {already === 1 ? 'día' : 'días'}: se reemplazan.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              className="mt-4 h-12 w-full text-base"
              disabled={pending || !ready}
            >
              {pending ? 'Guardando…' : `Guardar el objetivo de ${monthName}`}
            </Button>
          </StepCard>
        </form>
      </NavDialog>
    </>
  )
}
