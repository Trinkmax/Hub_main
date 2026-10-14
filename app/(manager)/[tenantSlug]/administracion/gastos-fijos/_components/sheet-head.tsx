import Link from 'next/link'
import { ChartSilhouette } from '@/components/administracion/charts/chart-parts'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { Explain, MathRow, MoneyHero, PillLink, StatusPill } from '@/components/administracion/kit'
import { addMonthsToYearMonth, endOfMonth, formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  monthWord,
  nextUpView,
  type Sheet,
  type SheetCarried,
  type SheetFilter,
  sheetCarry,
  sheetSentence,
} from '../_lib/planilla-words'
import { NextUp } from './next-up'

/**
 * La cabecera de la planilla: «Te falta de gasto fijo», el número que manda,
 * con su oración, la barra de los tres totales de la planilla de los socios
 * (ya pagaste · vencido · por vencer), «¿Cómo se calcula?» y, al lado, «Lo que
 * sigue» con el único botón primario de la pantalla.
 *
 * Cuatro cosas que no se negocian:
 * - sin renglones no hay número: hay un titular («En octubre no vence ninguno»);
 * - con renglones que no suman (ninguno tiene monto) tampoco: nunca «$ 0» por
 *   un dato que falta («Todavía no sé cuánto te falta»);
 * - mirando el mes que viene, lo que quedó de antes sin pagar NO entra al
 *   número: va aparte, con su link a la hoja de hoy. Si es lo único que hay,
 *   no hay número («Noviembre todavía no se armó»);
 * - en el celular el orden es número → oración → «Lo que sigue» → barra, así
 *   el botón queda en la primera pantalla.
 */

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground'
const LINK =
  'rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring'

/** Lo que quedó de antes, al lado del número del mes que viene: cuánto es y dónde se paga. */
function CarriedAside({
  carried,
  href,
  className,
}: {
  carried: SheetCarried
  href: string
  className?: string
}) {
  const count = carried.count === 1 ? '1 gasto sin pagar' : `${carried.count} gastos sin pagar`
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm', className)}>
      <StatusPill tone="warn">Quedó de antes</StatusPill>
      {carried.cents > 0 ? (
        <span className="font-medium tabular-nums">{formatCentsShort(carried.cents)}</span>
      ) : null}
      <span className="text-muted-foreground">
        {carried.cents > 0 ? '· ' : null}
        {count}
      </span>
      <Link href={href} className={LINK}>
        Ver {monthWord(carried.month)}
      </Link>
    </p>
  )
}

/**
 * Lo que va a aparecer acá cuando los gastos tengan monto: la silueta de la barra
 * de tres tramos con su leyenda, sin números (no inventa ninguno). Solo en la compu,
 * donde el titular queda al lado de «Para arrancar» y si no, sobra media tapa vacía;
 * en el celular el orden ya lleva al botón.
 */
function ComingBar({ className }: { className?: string }) {
  const legend = [
    { label: 'Ya pagaste', swatch: 'bg-success' },
    { label: 'Vencido', swatch: 'bg-destructive' },
    { label: 'Por vencer', swatch: 'bg-adm-neutral' },
  ]
  return (
    <figure className={cn('max-w-[34rem] space-y-3', className)}>
      <ChartSilhouette kind="split" />
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
        {legend.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            <span aria-hidden className={cn('size-2.5 rounded-full opacity-60', item.swatch)} />
            {item.label}
          </li>
        ))}
      </ul>
      <figcaption className="text-xs leading-relaxed text-muted-foreground text-pretty">
        Cuando tengan monto, acá vas a ver cuánto ya pagaste, cuánto se venció y cuánto te falta.
      </figcaption>
    </figure>
  )
}

export function SheetHead({
  sheet,
  canWrite,
  fillHref,
  miscHref,
  nextMonthHref,
  currentMonthHref,
  filterHref,
}: {
  sheet: Sheet
  canWrite: boolean
  /** «Completar la planilla». */
  fillHref: string
  miscHref: string
  nextMonthHref: string
  /** La hoja del mes de hoy: donde se paga lo que quedó de antes. */
  currentMonthHref: string
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
  const carried = sentence.kind === 'empty' ? undefined : sentence.carried
  // Con algo de antes aparte, el número es solo lo del mes: la barra de los tres totales (que
  // es de toda la hoja) no va; va la cuenta de lo del mes.
  const own = sentence.kind === 'number' && carried ? (sheetCarry(sheet)?.ownTotals ?? null) : null
  const hasBar = sentence.kind === 'number' && !carried && progress.totalCents > 0
  const hasLower = hasBar || own !== null
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
          // Sin número ni barra, el titular arranca arriba, a la altura de lo que sigue.
          hasSide && !hasLower && 'lg:row-span-2 lg:self-start',
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
            <p className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-balance lg:text-4xl">
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
            {sentence.kind === 'no_amounts' && hasSide && !carried ? (
              <ComingBar className="mt-6 max-lg:hidden" />
            ) : null}
            {sentence.kind === 'carried' ? (
              // El paso que sigue es la hoja de hoy: ahí están «Lo que sigue» y su botón.
              <p className="mt-4">
                <PillLink href={currentMonthHref} scroll={false} size="touch" className="px-5">
                  Ver {monthWord(sentence.carried.month)}
                </PillLink>
              </p>
            ) : carried ? (
              <CarriedAside carried={carried} href={currentMonthHref} className="mt-4" />
            ) : null}
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
          {/* La barra mide lo mismo que su leyenda: cada importe cae debajo de su extremo. */}
          <SplitBar
            height={12}
            className="max-w-[34rem]"
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

      {own && carried ? (
        <div className={cn('min-w-0 space-y-3', hasSide && 'lg:col-span-7')}>
          <CarriedAside carried={carried} href={currentMonthHref} />
          <Explain
            note={`Suma los gastos fijos que ya tienen su vencimiento en ${mes}. Lo que quedó de antes sin pagar va aparte: cuando lo pagues, se suma acá su vencimiento de ${mes}. Los que no tienen monto no suman.`}
          >
            <MathRow label={`Lo que vence en ${mes}`} value={formatCentsShort(own.totalCents)} />
            <MathRow op="−" label="Ya pagaste" value={formatCentsShort(own.paidCents)} />
            <MathRow op="=" label="Te falta" value={formatCentsShort(own.remainingCents)} />
          </Explain>
        </div>
      ) : null}
    </div>
  )
}
