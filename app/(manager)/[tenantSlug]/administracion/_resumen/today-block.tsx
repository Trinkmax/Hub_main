import { Check, CircleAlert, Clock3, Info, type LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'
import { heroState, setupNext, type TodayItem } from '@/lib/accounting/home'
import { cn } from '@/lib/utils'
import { HomeActionButton } from './home-action'
import type { HomeData } from './home-data'
import { SetupStrip } from './setup-strip'

/**
 * Desde qué ancho de su propio contenedor las tarjetas van en fila. Depende de
 * cuántas son: cinco necesitan casi el doble de lugar que tres. Con menos
 * ancho (el celular, el menú abierto en una compu chica) van apiladas, con el
 * riel a la izquierda. Las clases están escritas enteras: Tailwind solo genera
 * las que encuentra como texto.
 */
const ROW = {
  few: {
    list: '@min-[40rem]:flex-row',
    item: '@min-[40rem]:min-w-0 @min-[40rem]:flex-1 @min-[40rem]:flex-col @min-[40rem]:gap-2.5',
    wide: '@min-[40rem]:flex-[1.35]',
    rail: '@min-[40rem]:flex-row',
    stub: '@min-[40rem]:hidden',
    line: '@min-[40rem]:mb-0 @min-[40rem]:-mr-3 @min-[40rem]:h-px @min-[40rem]:w-auto',
    card: '@min-[40rem]:flex-col @min-[40rem]:items-stretch @min-[40rem]:justify-start',
    action: '@min-[40rem]:mt-auto',
    button: '@min-[40rem]:w-full',
  },
  four: {
    list: '@min-[52rem]:flex-row',
    item: '@min-[52rem]:min-w-0 @min-[52rem]:flex-1 @min-[52rem]:flex-col @min-[52rem]:gap-2.5',
    wide: '@min-[52rem]:flex-[1.35]',
    rail: '@min-[52rem]:flex-row',
    stub: '@min-[52rem]:hidden',
    line: '@min-[52rem]:mb-0 @min-[52rem]:-mr-3 @min-[52rem]:h-px @min-[52rem]:w-auto',
    card: '@min-[52rem]:flex-col @min-[52rem]:items-stretch @min-[52rem]:justify-start',
    action: '@min-[52rem]:mt-auto',
    button: '@min-[52rem]:w-full',
  },
  five: {
    list: '@min-[64rem]:flex-row',
    item: '@min-[64rem]:min-w-0 @min-[64rem]:flex-1 @min-[64rem]:flex-col @min-[64rem]:gap-2.5',
    wide: '@min-[64rem]:flex-[1.35]',
    rail: '@min-[64rem]:flex-row',
    stub: '@min-[64rem]:hidden',
    line: '@min-[64rem]:mb-0 @min-[64rem]:-mr-3 @min-[64rem]:h-px @min-[64rem]:w-auto',
    card: '@min-[64rem]:flex-col @min-[64rem]:items-stretch @min-[64rem]:justify-start',
    action: '@min-[64rem]:mt-auto',
    button: '@min-[64rem]:w-full',
  },
} as const

type RowClasses = (typeof ROW)[keyof typeof ROW]

/**
 * En oscuro el botón en contorno toma el fondo de la página, más oscuro que la
 * tarjeta: cuatro seguidos se veían como bloques negros que competían con el
 * botón dorado. Acá queda transparente, con el borde a la vista.
 */
const OUTLINE_ON_DARK = 'dark:border-foreground/25 dark:bg-transparent'

/** El estado nunca va solo en color: un ícono al lado de la frase que lo dice. */
const TONE_ICON: Partial<Record<TodayItem['tone'], { icon: LucideIcon; className: string }>> = {
  late: { icon: CircleAlert, className: 'text-destructive' },
  warn: { icon: Clock3, className: 'text-warning-text' },
  info: { icon: Info, className: 'text-info' },
}

/**
 * «Hoy te toca»: de 3 a 5 tarjetas numeradas, en el orden del día (el cierre
 * de ayer, el gasto de hoy, lo que vence y, solo cuando tocan, lo de la semana
 * y lo del mes). Las arma `buildToday` (puro, con tests); acá se dibujan.
 *
 * La primera sin hacer es «la del momento»: va resaltada y lleva el único
 * botón relleno de la pantalla. Las hechas quedan atenuadas y con tilde. La
 * contadora ve las mismas tarjetas como estado, sin ninguna acción.
 *
 * Mientras la puesta en marcha esté incompleta, debajo va su franja, en un
 * renglón: primero lo de hoy (el número y la primera acción entran en la
 * primera pantalla), después lo que falta para dejar todo andando.
 */
export async function TodayBlock({
  data,
  setupCookie,
  setupCollapsed,
}: {
  data: HomeData
  setupCookie: string
  setupCollapsed: boolean
}) {
  const [agenda, summaryResult, settingsResult] = await Promise.all([
    data.agenda,
    data.summary,
    data.settings,
  ])
  const { today: items, setup } = agenda
  const { canWrite } = data

  // Si el héroe ya ofrece el paso que lo destraba («Cargar lo que hay»), ese es el botón
  // relleno de la pantalla: acá quedan todos en contorno.
  const hero = summaryResult.ok
    ? heroState(summaryResult.data, settingsResult.ok ? settingsResult.data : null, {
        canWrite,
        base: data.base,
      })
    : null
  const heroHasAction = hero?.kind === 'unknown' && canWrite
  // La franja no repite lo que ya ofrecen el héroe y las tarjetas.
  const setupSteps = setupNext(setup, { hero, today: items })
  const current = canWrite ? (items.find((i) => !i.done && i.action !== null)?.id ?? null) : null
  const waiting = items.filter((i) => !i.done && (i.tone === 'late' || i.tone === 'warn')).length
  const row = items.length <= 3 ? ROW.few : items.length === 4 ? ROW.four : ROW.five

  return (
    <section aria-labelledby="hoy-te-toca" className="space-y-3 sm:space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="hoy-te-toca"
          className="font-serif text-xl font-semibold leading-tight tracking-tight sm:text-2xl"
        >
          {canWrite ? 'Hoy te toca' : 'El día a día del bar'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {/* Sin el resumen faltan tarjetas: no se afirma una cuenta que cambia sola. */}
          {!summaryResult.ok
            ? 'Puede faltar algo: no cargó el resumen.'
            : waiting === 0
              ? 'No hay nada atrasado.'
              : waiting === 1
                ? 'Hay 1 cosa esperando.'
                : `Hay ${waiting} cosas esperando.`}
        </p>
      </div>

      <div className="@container">
        <ol className={cn('flex flex-col gap-3', row.list)}>
          {items.map((item, index) => (
            <TodayCard
              key={item.id}
              item={item}
              n={index + 1}
              last={index === items.length - 1}
              current={item.id === current}
              filled={item.id === current && !heroHasAction}
              row={row}
            />
          ))}
        </ol>
      </div>

      {setup.complete ? null : (
        <SetupStrip
          // Sin el resumen el avance sale a medias («7 de 14» donde eran «9 de 16»): no se dice.
          title={summaryResult.ok ? setup.title : 'Puesta en marcha'}
          done={summaryResult.ok ? setup.done : 0}
          total={summaryResult.ok ? setup.total : 0}
          next={setupSteps}
          guideHref={setup.guideHref}
          cookieName={setupCookie}
          initialCollapsed={setupCollapsed}
        />
      )}
    </section>
  )
}

function TodayCard({
  item,
  n,
  last,
  current,
  filled,
  row,
}: {
  item: TodayItem
  n: number
  last: boolean
  /** La del momento: la primera sin hacer. */
  current: boolean
  /** Lleva el botón relleno (uno solo en la pantalla). */
  filled: boolean
  row: RowClasses
}) {
  const tone = item.done ? undefined : TONE_ICON[item.tone]
  const ToneIcon = tone?.icon

  return (
    <li
      className={cn('stagger-item flex gap-3', row.item, current && row.wide)}
      style={{ '--i': n - 1 } as CSSProperties}
    >
      {/* El riel: une los números. Vertical a la izquierda cuando van apiladas, horizontal
          arriba cuando van en fila; el tramo entra en el hueco entre tarjetas. */}
      <div aria-hidden className={cn('flex flex-col items-center', row.rail)}>
        <span className={cn('h-3.5 w-px', n === 1 ? 'bg-transparent' : 'bg-border', row.stub)} />
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
            item.done && 'border-success/40 bg-success/12 text-success',
            !item.done &&
              current &&
              'border-primary bg-primary text-primary-foreground ring-4 ring-primary/15',
            !item.done && !current && 'border-border bg-card text-foreground',
          )}
        >
          {item.done ? <Check className="size-3.5" strokeWidth={3} /> : n}
        </span>
        {last ? null : <span className={cn('-mb-3 w-px flex-1 bg-border', row.line)} />}
      </div>

      <div
        className={cn(
          'flex min-w-0 flex-1 gap-3 rounded-2xl border p-4',
          // La del momento lleva su botón grande debajo; las demás van en un renglón (el
          // texto a la izquierda, el botón chico a la derecha) también en el celular:
          // con el botón a todo el ancho, cinco tarjetas eran una pantalla entera.
          filled
            ? 'flex-col @min-[30rem]:flex-row @min-[30rem]:items-center @min-[30rem]:justify-between'
            : 'flex-row items-center justify-between',
          row.card,
          item.done
            ? 'border-border/60 bg-card/50'
            : cn(
                'card-hairline bg-card shadow-xs',
                current && 'border-primary/35 ring-4 ring-primary/8',
              ),
        )}
      >
        <div className="min-w-0">
          <h3
            className={cn(
              'leading-snug text-balance',
              item.done
                ? 'text-sm font-medium text-muted-foreground'
                : 'text-[15px] font-semibold text-foreground',
            )}
          >
            <span className="sr-only">
              {n}. {item.done ? 'Hecho: ' : ''}
            </span>
            {item.title}
          </h3>
          <p
            className={cn(
              'mt-1 flex items-start gap-1.5 text-sm leading-snug text-pretty',
              item.done || !tone ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {ToneIcon ? (
              <ToneIcon aria-hidden className={cn('mt-0.5 size-4 shrink-0', tone?.className)} />
            ) : null}
            <span className="min-w-0">{item.status}</span>
          </p>
        </div>
        {item.action ? (
          <div
            className={cn(
              'shrink-0',
              // En angosto el botón chico no pasa de 7rem: un texto largo baja a dos renglones.
              !filled && 'max-w-[7rem] @min-[30rem]:max-w-none',
              row.action,
            )}
          >
            <HomeActionButton
              action={item.action}
              variant={filled ? 'default' : 'outline'}
              className={cn(
                filled ? 'min-h-12 w-full font-semibold @min-[30rem]:w-auto' : OUTLINE_ON_DARK,
                row.button,
              )}
            />
          </div>
        ) : null}
      </div>
    </li>
  )
}
