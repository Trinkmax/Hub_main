import { ArrowDown, ArrowUp, ChevronDown, Minus } from 'lucide-react'
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
 * Dos formas, según el ancho del PANEL (y no de la ventana: el menú lateral le saca 260 px):
 *
 * - Acostado (desde 54rem, que entra en una notebook de 1280 px con el menú abierto): cinco
 *   columnas. Cada parada reparte sus renglones en la misma grilla (`subgrid`), así el estado,
 *   la descripción, las flechas y los botones arrancan a la misma altura en las cinco, tenga o
 *   no tenga estado cada una.
 * - Parado (el celular): una línea a la izquierda. Se ven el título, el estado, las flechas y
 *   los botones; «qué es y qué mueve», en palabras, se abre tocando el título (viene abierto en
 *   la que te toca). Así las cinco entran en dos pantallas.
 *
 * Server-safe; lo único cliente es el botón de cada parada (`GuideDo`), que no se dibuja en modo
 * lectura.
 */

const POCKETS: readonly MoneyPocket[] = ['cajas', 'en_camino', 'deuda']

/* La línea pasa por el centro de cada parada: arriba las impares, abajo las pares. Lienzo de
   1000 × 64 que se estira a lo ancho; el alto es el real, así las paradas caen justo. */
const ROUTE = 'M0 20C125 20 125 44 250 44S375 20 500 20 625 44 750 44 875 20 1000 20'

/* Sobre el panel verde, el anillo de foco va en dorado y despegado: el del tema (verde oliva)
   casi no se veía contra el fondo. */
const HERO_FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adm-gold focus-visible:ring-offset-2 focus-visible:ring-offset-adm-hero'

const WHAT = 'text-sm leading-relaxed text-adm-hero-fg/90 text-pretty'
const MOVES_TEXT = 'text-[13px] leading-relaxed text-adm-hero-muted text-pretty'
const TITLE = 'font-serif text-xl leading-tight font-semibold tracking-tight text-adm-hero-fg'

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
  const heading = (
    <>
      <span className="sr-only">Parada {station.n}: </span>
      {station.title}
    </>
  )
  return (
    <li
      style={{ '--i': station.n - 1 } as CSSProperties}
      // Acostado, cada parada es una columna que usa los renglones de la grilla de todas.
      className="stagger-item relative pb-6 pl-14 last:pb-0 @[54rem]:row-span-6 @[54rem]:grid @[54rem]:grid-rows-subgrid @[54rem]:px-3 @[54rem]:pt-[5.5rem] @[54rem]:pb-0"
    >
      {last ? null : (
        // Parado: el tramo que baja hasta la parada siguiente.
        <span
          aria-hidden
          className="absolute top-10 bottom-0 left-[19px] w-0.5 rounded-full bg-adm-gold/45 @[54rem]:hidden"
        />
      )}
      <span
        aria-hidden
        className={cn(
          'absolute top-0 left-0 flex size-10 items-center justify-center rounded-full font-serif text-lg leading-none font-semibold @[54rem]:left-3',
          low ? '@[54rem]:top-6' : '@[54rem]:top-0',
          current
            ? 'bg-adm-gold text-adm-hero-2 ring-4 ring-adm-gold/25'
            : 'bg-adm-hero-fg text-adm-hero',
        )}
      >
        {station.n}
      </span>

      {/* 1 · Acostado: el dibujo arriba y el título debajo. */}
      <div className="hidden @[54rem]:block">
        <StationArt id={station.id} className="size-16" />
        <h3 className={cn(TITLE, 'mt-3.5')}>{heading}</h3>
      </div>

      {/* Parado: el título abre «qué es y qué mueve». Abierto en la que te toca. */}
      <details open={current} className="group/stop @[54rem]:hidden">
        <summary
          className={cn(
            'flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-lg [&::-webkit-details-marker]:hidden',
            HERO_FOCUS,
          )}
        >
          <h3 className={cn(TITLE, 'min-w-0')}>{heading}</h3>
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-adm-hero-muted transition-transform duration-200 group-open/stop:rotate-180 motion-reduce:transition-none"
          />
          <span className="sr-only">Qué es y qué mueve</span>
          <StationArt id={station.id} className="ml-auto size-11 shrink-0" />
        </summary>
        <div className="max-w-xl space-y-1.5 pt-1.5 pb-1">
          <p className={WHAT}>{station.what}</p>
          <p className={MOVES_TEXT}>{station.movesText}</p>
        </div>
      </details>

      {/* 2 · Al día o te toca, con su píldora. Lo que todavía no aplica va solo en palabras: una
          píldora ahí parecería un pendiente. Sin estado, el renglón queda vacío (y acostado igual
          ocupa su lugar, para que las cinco columnas arranquen parejas). */}
      {status ? (
        <p className="mt-1.5 flex max-w-xl flex-wrap content-start items-center gap-x-2 gap-y-1 text-[13px] text-adm-hero-muted @[54rem]:mt-2">
          {status.state === 'done' ? <StatusPill tone="ok">{status.text}</StatusPill> : null}
          {status.state === 'todo' ? <StatusPill tone="warn">Te toca</StatusPill> : null}
          {status.state === 'done' ? null : <span>{status.text}.</span>}
        </p>
      ) : (
        <span aria-hidden className="hidden @[54rem]:block" />
      )}

      {/* 3 · Qué se hace (parado va dentro del título que se abre). */}
      <p className={cn(WHAT, 'mt-2 hidden @[54rem]:block')}>{station.what}</p>

      {/* 4 · Qué mueve, en flechas. */}
      <div className="mt-2.5 max-w-xl @[54rem]:mt-3.5">
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
      </div>

      {/* 5 · Qué mueve, en palabras. */}
      <p className={cn(MOVES_TEXT, 'mt-2 hidden @[54rem]:block')}>{station.movesText}</p>

      {/* 6 · Cómo se hace y el botón que lo abre. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 @[54rem]:mt-4 @[54rem]:gap-y-2">
        <Link
          href={`${base}${GUIDE_PATHS.daily}#${recipeAnchor(station.recipe)}`}
          className={cn(
            'inline-flex min-h-9 items-center rounded-sm text-sm font-medium text-adm-hero-fg underline decoration-adm-hero-fg/40 underline-offset-4 transition-colors hover:decoration-adm-hero-fg pointer-coarse:min-h-11',
            HERO_FOCUS,
          )}
        >
          Ver cómo
          <span className="sr-only">: {station.title}</span>
        </Link>
        <GuideDo
          target={station.action.target}
          look={current ? 'gold' : 'onHero'}
          // Con las columnas angostas (una notebook), la flecha no entra: queda el texto solo.
          className="focus-visible:ring-adm-gold @min-[54rem]:@max-[62rem]:[&_svg]:hidden"
        >
          {station.action.label}
        </GuideDo>
      </div>
    </li>
  )
}

export function StationMap({ base, states }: { base: string; states: StationStates }) {
  return (
    <HeroPanel tone="bosque" className="@container">
      <div className="flex flex-col gap-3 @[54rem]:flex-row @[54rem]:items-end @[54rem]:justify-between @[54rem]:gap-8">
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

      <div className="relative mt-6 @[54rem]:-mx-3 @[54rem]:mt-7">
        {/* Acostado: la línea entera, que se dibuja sola de izquierda a derecha. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 1000 64"
          preserveAspectRatio="none"
          fill="none"
          className="pointer-events-none absolute top-0 left-8 hidden h-16 w-4/5 @[54rem]:block"
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
        <ol className="relative grid @[54rem]:grid-cols-5">
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

      <div className="mt-7 border-t border-white/10 pt-5 @[54rem]:mt-8">
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
