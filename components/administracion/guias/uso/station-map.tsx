import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { HeroPanel } from '@/components/administracion/kit/hero'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import {
  GUIDE_PATHS,
  GUIDE_STATIONS,
  type GuideStation,
  type GuideStatus,
  MONEY_POCKET_HINT,
  MONEY_POCKET_LABEL,
  type MoneyPocket,
  recipeAnchor,
  type StationStates,
} from '@/lib/accounting/guides'
import { cn } from '@/lib/utils'
import { GuideDo } from './guide-do'
import { StationArt } from './station-art'

/**
 * El mapa: cinco paradas unidas por una línea, siempre en el mismo orden (vendés → comprás y
 * gastás → pagás → controlás la plata → fin de mes). Cada una dice qué se hace y QUÉ MUEVE en la
 * plata, que es lo que no se entendía con las pantallas vacías («¿cómo se arma la caja?»).
 *
 * Va sobre el panel verde, como la pizarra del bar: la línea dorada se dibuja sola al entrar, las
 * paradas son círculos crema y la que te toca queda dorada, con su botón. El estado sale de lo
 * que ya hay cargado (`stationStates`); sin datos, el mapa se ve igual, sin marcas.
 *
 * Acostado (cinco columnas) cuando el panel da para eso y parado (una línea a la izquierda) en
 * el celular: se mide el PANEL y no la ventana, porque el menú lateral le saca 260 px.
 * Server-safe; lo único cliente es «Hacerlo ahora» (`GuideDo`), que no se dibuja en modo lectura.
 */

const POCKETS: readonly MoneyPocket[] = ['cajas', 'en_camino', 'deuda']

/* La línea pasa por el centro de cada parada: arriba las impares, abajo las pares. Lienzo de
   1000 × 64 que se estira a lo ancho; el alto es el real, así las paradas caen justo. */
const ROUTE = 'M0 20C125 20 125 44 250 44S375 20 500 20 625 44 750 44 875 20 1000 20'

function Move({ pocket, direction }: { pocket: MoneyPocket; direction: 'up' | 'down' }) {
  const up = direction === 'up'
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <li className="inline-flex h-7 items-center gap-1 rounded-full bg-white/10 pr-2.5 pl-1.5 text-xs font-medium text-adm-hero-fg">
      <Icon
        aria-hidden
        strokeWidth={2.75}
        className={cn('size-3.5 shrink-0', up ? 'text-adm-gold' : 'text-adm-hero-fg')}
      />
      <span className="sr-only">{up ? 'Sube' : 'Baja'}: </span>
      {MONEY_POCKET_LABEL[pocket]}
    </li>
  )
}

function Station({
  station,
  base,
  status,
  current,
  last,
}: {
  station: GuideStation
  base: string
  status: GuideStatus | null
  current: boolean
  last: boolean
}) {
  const low = station.n % 2 === 0
  return (
    <li
      style={{ '--i': station.n - 1 } as CSSProperties}
      // Acostado, cada parada es una columna: las acciones van al fondo, alineadas entre sí.
      className="stagger-item relative pb-9 pl-14 last:pb-0 @[60rem]:flex @[60rem]:flex-col @[60rem]:px-3 @[60rem]:pt-[5.5rem] @[60rem]:pb-0"
    >
      {last ? null : (
        // Parado: el tramo que baja hasta la parada siguiente.
        <span
          aria-hidden
          className="absolute top-10 bottom-0 left-[19px] w-0.5 rounded-full bg-adm-gold/45 @[60rem]:hidden"
        />
      )}
      <span
        aria-hidden
        className={cn(
          'absolute top-0 left-0 flex size-10 items-center justify-center rounded-full font-serif text-lg leading-none font-semibold @[60rem]:left-3',
          low ? '@[60rem]:top-6' : '@[60rem]:top-0',
          current
            ? 'bg-adm-gold text-adm-hero-2 ring-4 ring-adm-gold/25'
            : 'bg-adm-hero-fg text-adm-hero',
        )}
      >
        {station.n}
      </span>

      {/* Parado, el dibujo va al lado del título; acostado, arriba. Lo demás usa todo el ancho. */}
      <div className="flex max-w-xl items-start justify-between gap-3 @[60rem]:flex-col-reverse @[60rem]:justify-start @[60rem]:gap-3.5">
        <h3 className="min-w-0 pt-1.5 font-serif text-xl leading-tight font-semibold tracking-tight text-adm-hero-fg @[60rem]:pt-0">
          <span className="sr-only">Parada {station.n}: </span>
          {station.title}
        </h3>
        <StationArt
          id={station.id}
          className="-mt-1 size-12 shrink-0 @[60rem]:mt-0 @[60rem]:size-16"
        />
      </div>
      <div className="max-w-xl">
        {status ? (
          // Al día o te toca, con su píldora. Lo que todavía no aplica va solo en palabras:
          // una píldora ahí parecería un pendiente.
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-adm-hero-muted">
            {status.state === 'done' ? <StatusPill tone="ok">{status.text}</StatusPill> : null}
            {status.state === 'todo' ? <StatusPill tone="warn">Te toca</StatusPill> : null}
            {status.state === 'done' ? null : <span>{status.text}.</span>}
          </p>
        ) : null}
        <p className="mt-2 text-sm leading-relaxed text-adm-hero-fg/90 text-pretty">
          {station.what}
        </p>
      </div>

      <div className="mt-3.5 max-w-xl">
        <p className="sr-only">Qué mueve:</p>
        <ul className="flex flex-wrap gap-1.5">
          {station.moves.length === 0 ? (
            <li className="inline-flex h-7 items-center gap-1 rounded-full bg-white/10 pr-2.5 pl-1.5 text-xs font-medium text-adm-hero-fg">
              <Minus aria-hidden strokeWidth={2.75} className="size-3.5 shrink-0" />
              No mueve plata
            </li>
          ) : (
            station.moves.map((move) => <Move key={move.pocket} {...move} />)
          )}
        </ul>
        <p className="mt-2 text-[13px] leading-relaxed text-adm-hero-muted text-pretty">
          {station.movesText}
        </p>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 @[60rem]:mt-auto @[60rem]:pt-4">
        <Link
          href={`${base}${GUIDE_PATHS.daily}#${recipeAnchor(station.recipe)}`}
          className="inline-flex min-h-9 items-center rounded-sm text-sm font-medium text-adm-hero-fg underline decoration-adm-hero-fg/40 underline-offset-4 transition-colors hover:decoration-adm-hero-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-11"
        >
          Ver cómo
          <span className="sr-only">: {station.title}</span>
        </Link>
        <GuideDo target={station.action.target} look={current ? 'gold' : 'onHero'}>
          {station.action.label}
        </GuideDo>
      </div>
    </li>
  )
}

export function StationMap({ base, states }: { base: string; states: StationStates }) {
  return (
    <HeroPanel tone="bosque" className="@container">
      <div className="flex flex-col gap-4 @[60rem]:flex-row @[60rem]:items-end @[60rem]:justify-between @[60rem]:gap-8">
        <div className="min-w-0">
          <h2 className="font-serif text-2xl leading-tight font-semibold tracking-tight text-balance text-adm-hero-fg sm:text-[28px]">
            Todo lo que cargás cae en una de estas cinco paradas
          </h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-adm-hero-muted text-pretty">
            Van siempre en este orden. Cada una mueve la plata de un lugar a otro: mirá las flechas.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
          {states.allClear ? <StatusPill tone="ok">Estás al día</StatusPill> : null}
          <ul
            aria-label="Cómo leer las flechas"
            className="flex items-center gap-3 text-xs text-adm-hero-muted"
          >
            <li className="inline-flex items-center gap-1">
              <ArrowUp aria-hidden strokeWidth={2.75} className="size-3.5 text-adm-gold" />
              sube
            </li>
            <li className="inline-flex items-center gap-1">
              <ArrowDown aria-hidden strokeWidth={2.75} className="size-3.5 text-adm-hero-fg" />
              baja
            </li>
          </ul>
        </div>
      </div>

      <div className="relative mt-7 @[60rem]:-mx-3">
        {/* Acostado: la línea entera, que se dibuja sola de izquierda a derecha. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 1000 64"
          preserveAspectRatio="none"
          fill="none"
          className="pointer-events-none absolute top-0 left-8 hidden h-16 w-4/5 @[60rem]:block"
        >
          <path
            d={ROUTE}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="2 9"
            className="stroke-adm-hero-fg/25"
          />
          <path
            d={ROUTE}
            pathLength={24}
            strokeWidth={2.5}
            strokeLinecap="round"
            className="adm-tick adm-tick-draw stroke-adm-gold [animation-delay:180ms] [animation-duration:1100ms]"
          />
        </svg>
        <ol className="relative grid @[60rem]:grid-cols-5">
          {GUIDE_STATIONS.map((station, index) => (
            <Station
              key={station.id}
              station={station}
              base={base}
              status={states.byId[station.id]}
              current={states.current === station.id}
              last={index === GUIDE_STATIONS.length - 1}
            />
          ))}
        </ol>
      </div>

      <div className="mt-8 border-t border-white/10 pt-5">
        <p className="text-[13px] text-adm-hero-muted">
          La plata del bar está siempre en uno de estos tres lugares.
        </p>
        <dl className="mt-3 grid gap-x-8 gap-y-3 @[40rem]:grid-cols-3">
          {POCKETS.map((pocket) => (
            <div key={pocket}>
              <dt className="text-sm font-semibold text-adm-hero-fg">
                {MONEY_POCKET_LABEL[pocket]}
              </dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed text-adm-hero-muted text-pretty">
                {MONEY_POCKET_HINT[pocket]}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </HeroPanel>
  )
}
