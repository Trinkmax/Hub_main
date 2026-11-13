'use client'

import { Check, SlidersHorizontal } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { normalizeStations, stationSummary, toggleStation } from '@/lib/pos/kitchen/stations'
import type { MenuStation } from '@/lib/pos/types'

/**
 * Qué estaciones muestra esta pantalla. Con una sola tele: todas. Una segunda en la barra: solo Barra.
 * Queda guardado en el dispositivo y en la dirección (ver `kitchen-live.tsx`).
 */
type Props = {
  stations: MenuStation[]
  selected: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (next: string[]) => void
}

export function StationPicker({ stations, selected, open, onOpenChange, onChange }: Props) {
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const current = normalizeStations(selected, stations)
  const summary = stationSummary(current, stations)

  useEffect(() => {
    if (!open) return
    wrap.current?.querySelector<HTMLButtonElement>('[data-first]')?.focus({ preventScroll: true })
    const close = (restoreFocus: boolean) => {
      onOpenChange(false)
      if (restoreFocus) trigger.current?.focus({ preventScroll: true })
      else (document.activeElement as HTMLElement | null)?.blur?.()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrap.current?.contains(event.target)) return
      close(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpenChange])

  // Con una sola estación no hay nada que elegir.
  if (stations.length < 2) return null

  return (
    <div ref={wrap} className="kds-stations">
      <button
        ref={trigger}
        type="button"
        className="kds-tool"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Estaciones de esta pantalla: ${summary}. Tocá para cambiar.`}
        data-short={current.length === 0 ? 'true' : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <SlidersHorizontal aria-hidden strokeWidth={2.4} />
        <span className="kds-tool-long">{summary}</span>
        {/* En el celular «Todas las estaciones» no entra al lado de la hora: ahí alcanza con «Todas». */}
        {current.length === 0 ? <span className="kds-tool-short">Todas</span> : null}
      </button>

      {open ? (
        <div id={id} className="kds-stations-menu">
          <p className="kds-stations-title">Qué muestra esta pantalla</p>
          <ul>
            <li>
              <button
                type="button"
                data-first
                aria-pressed={current.length === 0}
                onClick={() => onChange([])}
              >
                <span className="kds-station-dot is-all" aria-hidden />
                <span>Todas las estaciones</span>
                {current.length === 0 ? <Check aria-hidden strokeWidth={3} /> : null}
              </button>
            </li>
            {stations.map((station) => {
              const on = current.includes(station.id)
              return (
                <li key={station.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange(toggleStation(current, station.id, stations))}
                  >
                    <span
                      className="kds-station-dot"
                      style={{ background: station.color }}
                      aria-hidden
                    />
                    <span>{station.name}</span>
                    {on ? <Check aria-hidden strokeWidth={3} /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
          <button type="button" className="kds-stations-done" onClick={() => onOpenChange(false)}>
            Listo
          </button>
        </div>
      ) : null}
    </div>
  )
}
