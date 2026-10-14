import Link from 'next/link'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { Explain, MathRow, MoneyHero, StatusPill } from '@/components/administracion/kit'
import { addMonthsToYearMonth, endOfMonth, formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  monthWord,
  nextUpView,
  type Sheet,
  type SheetFilter,
  sheetSentence,
} from '../_lib/planilla-words'
import { NextUp } from './next-up'

/**
 * La cabecera de la planilla: «Te falta de gasto fijo», el número que manda,
 * con su oración, la barra de los tres totales de la planilla de los socios
 * (ya pagaste · vencido · por vencer), «¿Cómo se calcula?» y, al lado, «Lo que
 * sigue» con el único botón primario de la pantalla.
 *
 * Tres cosas que no se negocian:
 * - sin renglones no hay número: hay un titular («En octubre no vence ninguno»);
 * - con renglones que no suman (ninguno tiene monto) tampoco: nunca «$ 0» por
 *   un dato que falta («Todavía no sé cuánto te falta»);
 * - en el celular el orden es número → oración → «Lo que sigue» → barra, así
 *   el botón queda en la primera pantalla.
 */

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground'
const LINK =
  'rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring'

export function SheetHead({
  sheet,
  canWrite,
  fillHref,
  miscHref,
  nextMonthHref,
  filterHref,
}: {
  sheet: Sheet
  canWrite: boolean
  /** «Completar la planilla». */
  fillHref: string
  miscHref: string
  nextMonthHref: string
  /** El link de un filtro, o `undefined` si ese filtro no filtraría nada. */
  filterHref: (filter: SheetFilter) => string | undefined
}) {
  const { progress, month } = sheet
  const mes = monthWord(month)
  const nextMes = monthWord(addMonthsToYearMonth(month, 1))
  const sentence = sheetSentence(sheet)
  const view = nextUpView(sheet, { canWrite })
  const label = `Te falta de gasto fijo · ${mes}`
  const hasSide = view.kind !== 'none' && !(view.kind === 'setup' && !canWrite)
  const hasBar = sentence.kind === 'number' && progress.totalCents > 0
  const upcomingCents = Math.max(0, progress.remainingCents - progress.overdueCents)

  return (
    <div
      className={cn(
        'grid gap-x-8 gap-y-5 p-5 sm:p-6',
        hasSide && 'lg:grid-cols-12 lg:grid-rows-[auto_1fr]',
      )}
    >
      <div
        className={cn(
          'min-w-0',
          hasSide && 'lg:col-span-7',
          // Sin número ni barra, el titular se acomoda a la altura de lo que sigue.
          hasSide && !hasBar && 'lg:row-span-2 lg:self-center',
        )}
      >
        {sentence.kind === 'number' ? (
          <MoneyHero
            size="xl"
            animate
            cents={sentence.cents}
            label={label}
            sentence={
              <>
                {sentence.allPaid ? (
                  <StatusPill tone="ok" className="mr-2 align-middle">
                    Al día
                  </StatusPill>
                ) : null}
                {sentence.text}
                {sentence.noAmount > 0 ? (
                  <>
                    {' '}
                    {sentence.noAmount === 1
                      ? 'Hay 1 sin monto: no suma.'
                      : `Hay ${sentence.noAmount} sin monto: no suman.`}
                    {canWrite ? (
                      <>
                        {' '}
                        <Link href={fillHref} className={LINK}>
                          Ponerles monto
                        </Link>
                      </>
                    ) : null}
                  </>
                ) : null}
              </>
            }
          />
        ) : (
          <div className="min-w-0">
            <p className={LABEL}>{label}</p>
            <p className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-balance">
              {sentence.title}
            </p>
            <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
              {sentence.text}
              {sentence.kind === 'empty' && sentence.nextMonth ? (
                <>
                  {' '}
                  <Link href={nextMonthHref} className={LINK}>
                    Ver {nextMes}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        )}
      </div>

      {hasSide ? (
        <NextUp
          view={view}
          canWrite={canWrite}
          fillHref={fillHref}
          miscHref={miscHref}
          nextMonthHref={nextMonthHref}
          nextMonthLabel={`Ver ${nextMes}`}
          className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:self-start"
        />
      ) : null}

      {hasBar ? (
        <div className={cn('min-w-0 space-y-3', hasSide && 'lg:col-span-7')}>
          <SplitBar
            height={12}
            ariaLabel={`Gastos fijos de ${mes}: pagaste ${formatCentsShort(progress.paidCents)} de ${formatCentsShort(progress.totalCents)}; vencido ${formatCentsShort(progress.overdueCents)}.`}
            segments={[
              {
                key: 'pagado',
                label: 'Ya pagaste',
                cents: progress.paidCents,
                swatch: 'bg-success',
                href: filterHref('pagado'),
              },
              {
                key: 'vencido',
                label: 'Vencido',
                cents: progress.overdueCents,
                swatch: 'bg-destructive',
                href: filterHref('vencido'),
              },
              {
                key: 'por-vencer',
                label: 'Por vencer',
                cents: upcomingCents,
                swatch: 'bg-adm-neutral',
                href: filterHref('por-vencer'),
              },
            ]}
          />
          <Explain note="Suma los gastos fijos que vencen este mes y los que quedaron vencidos de antes. Los que no tienen monto no suman. Los montos son los que cargaste en cada uno: si alguno cambia todos los meses, es un estimado. Es el mismo número del Resumen.">
            <MathRow
              label={`Lo que vence hasta el ${formatDayMonth(endOfMonth(month))}`}
              value={formatCentsShort(progress.totalCents)}
            />
            <MathRow op="−" label="Ya pagaste" value={formatCentsShort(progress.paidCents)} />
            <MathRow op="=" label="Te falta" value={formatCentsShort(progress.remainingCents)} />
          </Explain>
        </div>
      ) : null}
    </div>
  )
}
