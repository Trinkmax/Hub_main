import { formatIsoDay } from '@/lib/dates'
import type { WantedRange } from '@/lib/imports/ui/inbox'

/**
 * «Qué pedir»: las dos fechas que hay que elegir en ARCA, en Mercado Pago o en
 * el home banking, en dos fichas grandes (cada una con su rótulo adentro: dos
 * fechas sueltas no dicen cuál es cuál), y una oración que explica por qué.
 *
 * Es lo que la pantalla vieja no decía: había que deducir las fechas de un
 * párrafo sobre «cada cuánto». Las calcula `wantedRange()` y nunca propone una
 * fecha anterior al arranque del bar. Server-safe.
 */
export function WantRange({ wanted }: { wanted: WantedRange }) {
  const hasRange = wanted.from !== null && wanted.to !== null
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Qué pedir
      </p>
      {hasRange ? (
        <dl className="grid max-w-md grid-cols-2 gap-2">
          <Tile label="Desde" day={wanted.from} />
          <Tile label="Hasta" day={wanted.to} />
        </dl>
      ) : null}
      <p className="max-w-prose text-sm leading-relaxed text-pretty">{wanted.sentence}</p>
      {wanted.extra ? (
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
          {wanted.extra}
        </p>
      ) : null}
      <p className="max-w-prose text-xs text-muted-foreground text-pretty">
        Si se pisan las fechas no pasa nada: lo que ya subiste no se repite.
      </p>
    </div>
  )
}

function Tile({ label, day }: { label: string; day: string | null }) {
  return (
    <div className="flex min-h-14 flex-col justify-center rounded-xl bg-secondary/50 px-3.5 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="font-serif text-xl font-semibold leading-tight tracking-tight tabular-nums">
        {formatIsoDay(day)}
      </dd>
    </div>
  )
}
