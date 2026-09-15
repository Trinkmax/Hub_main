'use client'

import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { TableChip } from '@/lib/salon/events-report'
import {
  fallenGroupLabel,
  nextWallIndex,
  splitWall,
  tableReadout,
  WALL_IDLE_READOUT,
  type WallLegendFlags,
  wallAriaLabel,
  wallSeats,
} from '@/lib/salon/tables-wall'
import { cn } from '@/lib/utils'

/**
 * El muro de mesas: una mesa por reserva, y una silla por persona.
 *
 * Por qué esto y no un gráfico:
 *
 * 1. La unidad del negocio es la mesa, no "la reserva". Once tableros son once
 *    mesas que hubo que sentar, y se cuentan con el ojo.
 * 2. Explica el tercer número, que es el más abstracto. "2,6 por reserva" no
 *    dice nada solo; un muro de mesitas de dos dice "vinieron de a pareja", y un
 *    muro con una mesa larguísima y cuatro chicas dice "esto fue un cumpleaños
 *    con relleno". Es la diferencia entre un promedio y su forma.
 * 3. **La escala es la misma en toda la pantalla** (una persona = `--mw-seat`
 *    píxeles), así que el evento y las reservas normales se comparan sin
 *    compartir eje y sin que el chico se aplaste. Sin piso de ancho: con un
 *    mínimo, una mesa de 2 y una de 3 miden igual justo en el tamaño más
 *    frecuente del bar.
 * 4. Transporta la asistencia sin un porcentaje, que no se puede mostrar sin
 *    mentir: silla llena = vino, hueca = no vino, tenue sobre tablero rayado =
 *    la mesa nunca se cerró, rayita suelta = se cayó. La cuenta de qué silla es
 *    qué vive en `lib/salon/tables-wall.ts`.
 *
 * El número exacto no va adentro: se lee arriba al pasar el mouse, TOCAR (en el
 * celular antes no aparecía nunca) o tabular. El muro es una sola parada de Tab
 * y las flechas recorren las mesas.
 *
 * El lector de pantalla lo oye UNA vez, en el nombre del botón que toma el foco.
 * El texto de arriba es solo para la vista (`aria-hidden`, sin `aria-live`): como
 * región viva repetía cada mesa dos veces y anunciaba cada mesa que cruzaba el mouse.
 */

type SeatsProps = { table: TableChip }

/** Las sillas de una mesa. Lo comparten el muro y la leyenda: se dibujan igual. */
function Seats({ table }: SeatsProps) {
  return wallSeats(table).map((seat) => (
    <span
      key={seat.key}
      aria-hidden
      className="wall-seat"
      data-pos={seat.pos}
      data-seat={seat.state}
      data-start={seat.start ? '' : undefined}
      data-end={seat.end ? '' : undefined}
    />
  ))
}

/** Los números del texto, resaltados: se lee primero la cantidad, después el resto. */
function Emphasis({ text }: { text: string }) {
  return text.split(/(\d+)/).map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: partes fijas de un string que no se reordena.
      <span key={i} className="font-medium text-foreground tabular-nums">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

/**
 * `:focus-visible` distingue el foco de teclado del de un click: con mouse o
 * dedo, el que manda es el hover o el toque, no el foco que deja el navegador.
 */
function isKeyboardFocus(el: HTMLElement): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

export function TablesWall({
  tables,
  title,
  className,
}: {
  tables: ReadonlyArray<TableChip>
  /** De quién son las mesas, para el lector de pantalla: "Noche Astral". */
  title: string
  className?: string
}) {
  // Tres fuentes de "mesa activa", en orden de prioridad: el mouse encima, el
  // foco de teclado y el toque fijo. Separadas porque se limpian distinto: el
  // hover al salir del muro, el foco al salir con Tab, el toque con otro toque
  // afuera o Esc. Manda la última forma de moverse: una tecla limpia el hover,
  // si no un mouse quieto encima del muro tapaba la mesa con foco (y la atenuaba).
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [stickyId, setStickyId] = useState<string | null>(null)
  const [tabStop, setTabStop] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (stickyId === null) return
    function onPointerDown(e: globalThis.PointerEvent) {
      const list = listRef.current
      if (list && e.target instanceof Node && list.contains(e.target)) return
      setStickyId(null)
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setStickyId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [stickyId])

  if (tables.length === 0) return null

  const { standing, fallen } = splitWall(tables)
  const ordered = [...standing, ...fallen]
  const activeId = hoverId ?? focusId ?? stickyId
  const active = activeId ? (ordered.find((t) => t.id === activeId) ?? null) : null
  const readout = active ? tableReadout(active) : null
  // Si cambian las mesas (otro día con el mismo bloque), la parada de Tab no
  // puede quedar apuntando a una mesa que ya no existe.
  const stop = Math.min(tabStop, ordered.length - 1)

  function onListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      setStickyId(null)
      setFocusId(null)
      setHoverId(null)
      return
    }
    const current = buttonsRef.current.indexOf(document.activeElement as HTMLButtonElement | null)
    if (current < 0) return
    const next = nextWallIndex(current, e.key, ordered.length)
    if (next === null) return
    e.preventDefault()
    setHoverId(null)
    setTabStop(next)
    buttonsRef.current[next]?.focus()
  }

  function onListPointerLeave(e: PointerEvent<HTMLUListElement>) {
    if (e.pointerType !== 'touch') setHoverId(null)
  }

  function renderTable(t: TableChip, index: number) {
    const r = tableReadout(t)
    return (
      <li key={t.id} className="flex max-w-full">
        <button
          ref={(el) => {
            buttonsRef.current[index] = el
          }}
          type="button"
          tabIndex={index === stop ? 0 : -1}
          aria-label={`${r.title} · ${r.detail}`}
          data-table={t.state}
          data-active={activeId === t.id ? '' : undefined}
          style={{ '--i': index } as CSSProperties}
          onPointerEnter={(e) => {
            // En touch el pointerenter llega pegado al click: si activara acá,
            // el click de al lado lo apagaría en el mismo toque.
            if (e.pointerType !== 'touch') setHoverId(t.id)
          }}
          onClick={() => setStickyId((cur) => (cur === t.id ? null : t.id))}
          onFocus={(e: FocusEvent<HTMLButtonElement>) => {
            setTabStop(index)
            if (isKeyboardFocus(e.currentTarget)) {
              setHoverId(null)
              setFocusId(t.id)
            }
          }}
          onBlur={(e: FocusEvent<HTMLButtonElement>) => {
            const next = e.relatedTarget
            if (!(next instanceof Node && listRef.current?.contains(next))) setFocusId(null)
          }}
          className={cn(
            'wall-table relative flex max-w-full cursor-pointer flex-wrap gap-y-0.5 rounded-[4px]',
            // Área de toque más grande que el dibujo: una mesa de 1 pasa a 19px.
            'before:absolute before:-inset-1.5',
            'outline-offset-2 outline-(--ev) focus-visible:outline-2',
          )}
        >
          <Seats table={t} />
        </button>
      </li>
    )
  }

  return (
    <figure className={cn('ev-ink m-0', className)}>
      {/* Dos renglones reservados siempre: en una ficha angosta (dos eventos en
          la noche, o el teléfono) el texto parte en dos, y cortarlo con «…» se
          comía justo el detalle, que es lo único que dice los números. Con el
          alto mínimo fijo el muro no salta al cambiar de mesa. */}
      <figcaption
        aria-hidden
        className="flex min-h-[2lh] min-w-0 items-end text-[11px] leading-snug text-muted-foreground"
      >
        <span className="text-pretty">
          {readout ? (
            <>
              <Emphasis text={readout.title} /> · <Emphasis text={readout.detail} />
            </>
          ) : (
            WALL_IDLE_READOUT
          )}
        </span>
      </figcaption>

      <ul
        ref={listRef}
        aria-label={wallAriaLabel(title, tables)}
        data-has-active={active ? '' : undefined}
        onKeyDown={onListKeyDown}
        onPointerLeave={onListPointerLeave}
        className="wall mt-1 flex flex-wrap items-start gap-x-2 gap-y-2.5 sm:gap-x-2.5 sm:gap-y-3"
      >
        {standing.map((t, i) => renderTable(t, i))}

        {fallen.length > 0 ? (
          <>
            {/* Las caídas van en su propia fila: están afuera de la gente que
                entró, y un separador de 1px no alcanzaba para decirlo. */}
            <li aria-hidden className="h-0 basis-full" />
            <li
              aria-hidden
              className="flex h-6 items-center text-[10px] text-muted-foreground sm:h-7"
            >
              {fallenGroupLabel(fallen)}
            </li>
            {fallen.map((t, j) => renderTable(t, standing.length + j))}
          </>
        ) : null}
      </ul>
    </figure>
  )
}

/** Mesas fijas de la leyenda: se dibujan con las mismas sillas que el muro. */
const LEGEND: ReadonlyArray<{ flag: keyof WallLegendFlags; label: string; chip: TableChip }> = [
  {
    flag: 'counted',
    label: 'mesa contada',
    chip: {
      id: 'l-counted',
      guests: 3,
      attended: 3,
      state: 'counted',
      label: null,
      fallenReason: null,
    },
  },
  {
    flag: 'empty',
    label: 'silla vacía',
    chip: {
      id: 'l-empty',
      guests: 3,
      attended: 2,
      state: 'counted',
      label: null,
      fallenReason: null,
    },
  },
  {
    flag: 'extra',
    label: 'se sumó alguien',
    chip: {
      id: 'l-extra',
      guests: 2,
      attended: 3,
      state: 'counted',
      label: null,
      fallenReason: null,
    },
  },
  {
    flag: 'open',
    label: 'sin cerrar',
    chip: {
      id: 'l-open',
      guests: 3,
      attended: null,
      state: 'open',
      label: null,
      fallenReason: null,
    },
  },
  {
    flag: 'fallen',
    label: 'se cayó',
    chip: {
      id: 'l-fallen',
      guests: 2,
      attended: null,
      state: 'fallen',
      label: null,
      fallenReason: null,
    },
  },
]

/**
 * Leyenda del muro. Va una sola vez por pantalla, no una por ficha, y solo con
 * lo que está dibujado. Sin tinta propia: en claro sale verde y en oscuro
 * dorado, porque explica el dibujo y no un evento en particular.
 */
export function TablesWallLegend({ flags }: { flags: WallLegendFlags }) {
  const items = LEGEND.filter((item) => flags[item.flag])
  if (items.length === 0) return null
  return (
    <ul className="ev-ink wall flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      {items.map((item) => (
        <li key={item.flag} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="wall-table flex" data-table={item.chip.state} data-static="">
            <Seats table={item.chip} />
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  )
}
