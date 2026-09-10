'use client'

import { useState } from 'react'
import type { TableChip } from '@/lib/salon/events-report'
import { cn } from '@/lib/utils'

/**
 * El muro de mesas: un bloque por reserva, y el ancho ES la cantidad de gente.
 *
 * Por qué esto y no un gráfico:
 *
 * 1. La unidad del negocio es la mesa, no "la reserva". Veintiún bloques son
 *    veintiuna mesas que hay que sentar, y se cuentan con el ojo.
 * 2. Explica el tercer número, que es el más abstracto. "2,5 por reserva" no
 *    dice nada solo; un muro de ladrillitos todos iguales dice "vinieron todos
 *    de a dos", y un muro con un bloque enorme y cuatro chicos dice "esto fue
 *    un cumpleaños con relleno". Es la diferencia entre un promedio y su forma.
 * 3. **La escala es la misma en toda la pantalla** (una persona = `--u`
 *    píxeles), así que el bloque del evento y el de las reservas normales se
 *    comparan sin compartir eje y sin que el chico se aplaste. Una noche de
 *    16 personas al lado de una de 125 se ve como lo que es.
 * 4. Transporta la cobertura de asistencia gratis: sólido = mesa cerrada y
 *    contada, punteado = mesa que quedó sin cerrar, contorno tachado = se cayó.
 *    Es el lugar del porcentaje de asistencia, que no se puede mostrar sin
 *    mentir.
 *
 * Sin piso de ancho a propósito: con un `min-width`, una mesa de 2 y una de 3
 * miden igual y el muro deja de valer la cantidad de gente — justo en el valor
 * más frecuente del bar. El número exacto no va adentro del bloque: se lee
 * arriba al pasar el mouse o tabular, igual que en el gráfico de señas.
 */

const STATE_CLASS: Record<TableChip['state'], string> = {
  counted: 'h-7 sm:h-8 bg-primary/25 border-primary/50',
  open: 'h-7 sm:h-8 bg-secondary/70 border-dashed border-border',
  fallen: 'h-4 sm:h-5 bg-transparent border-border/60',
}

function chipLabel(chip: TableChip): string {
  const gente = `${chip.guests} ${chip.guests === 1 ? 'persona' : 'personas'}`
  if (chip.state === 'fallen') return `Mesa de ${gente} · se cayó`
  if (chip.attended === null) return `Mesa de ${gente} · quedó sin cerrar`
  if (chip.attended === chip.guests) return `Mesa de ${gente} · vinieron los ${chip.attended}`
  return `Mesa de ${gente} · se contaron ${chip.attended}`
}

export function TablesWall({ tables, className }: { tables: TableChip[]; className?: string }) {
  const [active, setActive] = useState<string | null>(null)

  if (tables.length === 0) return null

  const enPie = tables.filter((t) => t.state !== 'fallen')
  const caidas = tables.filter((t) => t.state === 'fallen')
  const hovered = active ? tables.find((t) => t.id === active) : undefined

  return (
    <figure
      className={cn('m-0 [--u:4px] sm:[--u:6px]', className)}
      onMouseLeave={() => setActive(null)}
      role="img"
      aria-label={`Muro de mesas: ${enPie.length} ${enPie.length === 1 ? 'mesa' : 'mesas'} en pie${
        caidas.length > 0 ? ` y ${caidas.length} caídas` : ''
      }. Cada bloque es una mesa y el ancho es la gente.`}
    >
      {/* Alto fijo: sin esto el muro salta cuando el mouse entra. */}
      <figcaption className="flex h-5 items-center text-[11px] text-muted-foreground">
        {hovered ? (
          <span className="text-foreground">{chipLabel(hovered)}</span>
        ) : (
          <span>Cada bloque es una mesa; el ancho, la gente.</span>
        )}
      </figcaption>

      <div className="mt-1.5 flex flex-wrap items-end gap-1">
        {enPie.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={chipLabel(t)}
            onMouseEnter={() => setActive(t.id)}
            onFocus={() => setActive(t.id)}
            onBlur={() => setActive(null)}
            style={{ width: `calc(var(--u) * ${t.guests})` }}
            className={cn(
              'cursor-default rounded-sm border outline-none transition-[filter]',
              'focus-visible:ring-2 focus-visible:ring-ring',
              STATE_CLASS[t.state],
              active === t.id && 'brightness-95',
            )}
          />
        ))}

        {caidas.length > 0 ? (
          <>
            {/* Separador: las caídas están afuera de la masa de gente que entró. */}
            <span aria-hidden className="mx-1 h-7 w-px shrink-0 bg-border/70 sm:h-8" />
            {caidas.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-label={chipLabel(t)}
                onMouseEnter={() => setActive(t.id)}
                onFocus={() => setActive(t.id)}
                onBlur={() => setActive(null)}
                style={{ width: `calc(var(--u) * ${t.guests})` }}
                className={cn(
                  'cursor-default rounded-sm border outline-none transition-[filter]',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                  STATE_CLASS.fallen,
                  active === t.id && 'brightness-95',
                )}
              />
            ))}
          </>
        ) : null}
      </div>
    </figure>
  )
}

/** Leyenda del muro. Va una sola vez por pantalla, no una por ficha. */
export function TablesWallLegend({ hasFallen }: { hasFallen: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <li className="inline-flex items-center gap-1.5">
        <span className="h-3 w-4 rounded-sm border border-primary/50 bg-primary/25" />
        mesa cerrada
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="h-3 w-4 rounded-sm border border-dashed border-border bg-secondary/70" />
        sin cerrar
      </li>
      {hasFallen ? (
        <li className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm border border-border/60" />
          se cayó
        </li>
      ) : null}
    </ul>
  )
}
