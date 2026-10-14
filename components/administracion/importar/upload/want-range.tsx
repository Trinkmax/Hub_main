import { formatDayMonth, formatIsoDay } from '@/lib/dates'
import type { WantedRange } from '@/lib/imports/ui/inbox'

/**
 * «Qué pedir»: las dos fechas que hay que elegir en ARCA, en Mercado Pago o en
 * el home banking, en dos fichas grandes (cada una con su rótulo adentro: dos
 * fechas sueltas no dicen cuál es cuál), y una oración que explica por qué.
 *
 * Es lo que la pantalla vieja no decía: había que deducir las fechas de un
 * párrafo sobre «cada cuánto». Las calcula `wantedRange()` y nunca propone una
 * fecha anterior al arranque del bar.
 *
 * Sin fechas (hoy no hay nada nuevo para pedir) lo dice como título, con la
 * oración completa debajo: no deja un «Qué pedir» sin nada que pedir.
 * Server-safe.
 */
export function WantRange({ wanted }: { wanted: WantedRange }) {
  const hasRange = wanted.from !== null && wanted.to !== null
  if (!hasRange) {
    return (
      <div className="space-y-1.5">
        <p className="font-serif text-xl font-semibold leading-snug tracking-tight text-balance">
          Hoy no hace falta pedir nada
        </p>
        <p className="max-w-prose text-sm leading-relaxed text-pretty">{wanted.sentence}</p>
        {wanted.extra ? (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
            {wanted.extra}
          </p>
        ) : null}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Qué pedir
      </p>
      <dl className="grid max-w-md grid-cols-2 gap-2">
        <Tile label="Desde" day={wanted.from} />
        <Tile label="Hasta" day={wanted.to} />
      </dl>
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

/**
 * Las mismas dos fechas, en chico: el resumen del paso 1 cuando está plegado.
 * Son el dato que el dueño viene a buscar cada semana, así que no pueden quedar
 * en una línea gris: cada una va en su ficha, con su rótulo adentro.
 *
 * Solo `<span>`: va adentro del párrafo de resumen de un paso. Para lectores, la
 * oración entera («Bajá del 08/10 al 12/10»); las fichas son su dibujo.
 */
export function WantRangeChips({ from, to }: { from: string; to: string }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className="sr-only">
        Bajá del {formatDayMonth(from)} al {formatDayMonth(to)}
      </span>
      <Chip label="Desde" day={from} />
      <Chip label="Hasta" day={to} />
    </span>
  )
}

function Chip({ label, day }: { label: string; day: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex items-baseline gap-1.5 rounded-lg bg-secondary/60 px-2.5 py-1"
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="font-serif text-base font-semibold leading-tight tracking-tight tabular-nums text-foreground">
        {formatDayMonth(day)}
      </span>
    </span>
  )
}
