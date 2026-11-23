'use client'

import { AlarmClock, ChevronRight, Timer } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { floorLegend, timingWords } from '@/lib/pos/floor/legend'
import { posFont } from '@/lib/pos/font'
import type { PosThresholds } from '@/lib/pos/types'
import { cn } from '@/lib/utils'
import { STATE_ICON } from './floor-model'
import './floor-legend.css'

/**
 * La leyenda del salón: qué quiere decir cada color y a los cuántos minutos una mesa avisa o se
 * pone roja. Los socios lo preguntaron («¿cuáles son los tiempos de las demoras?»): estaba en
 * Ajustes, pero quien mira el mapa no tenía dónde leerlo.
 *
 * Cada renglón usa la misma chapa que la mesa lleva en el mapa (color + ícono + palabra), así se
 * reconoce sin leer. Los minutos son los del bar (`pos_settings`); el dueño los cambia desde acá.
 */
export function FloorLegend({
  open,
  onClose,
  thresholds,
  settingsHref,
}: {
  open: boolean
  onClose: () => void
  thresholds: PosThresholds | null
  /** A dónde va «Cambiar los tiempos». Sin dato (no es dueño), se dice quién los cambia. */
  settingsHref: string | null
}) {
  const rows = useMemo(() => floorLegend(thresholds), [thresholds])
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet', posFont.variable)}
        data-testid="leyenda"
      >
        <SheetGrabber />
        <div className="pos-sheet-body pos-legend">
          <SheetTitle className="pos-sheet-title">Qué dice cada color</SheetTitle>
          <SheetDescription className="pos-legend-sub">
            La mesa cambia sola, sin que nadie toque nada. Cuando se le pasa el tiempo, primero
            avisa con un borde amarillo y después se pone roja.
          </SheetDescription>

          <ul className="pos-legend-list">
            {rows.map((row) => {
              const Icon = row.key === 'late' ? AlarmClock : STATE_ICON[row.key]
              const timing = timingWords(row)
              return (
                <li key={row.key} className="pos-legend-row">
                  <span
                    className={cn(
                      'pos-legend-plate',
                      row.key === 'late' ? 'pos-urg-late' : `pos-st-${row.key}`,
                    )}
                  >
                    <Icon aria-hidden strokeWidth={2.4} />
                    {row.label}
                  </span>
                  <span className="pos-legend-text">
                    <span>{row.meaning}</span>
                    {timing ? (
                      <b>
                        <Timer aria-hidden strokeWidth={2.4} />
                        {timing}
                      </b>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>

          {settingsHref ? (
            <Link href={settingsHref} className="pos-legend-link" data-testid="leyenda-ajustes">
              <span>
                <b>Cambiar los tiempos</b>
                <small>Son los de todo el bar. Se guardan solos.</small>
              </span>
              <ChevronRight aria-hidden strokeWidth={2.4} />
            </Link>
          ) : (
            <p className="pos-legend-foot">Los tiempos los cambia un dueño, desde Sucursales.</p>
          )}

          <button type="button" className="pos-btn pos-btn-primary" onClick={onClose}>
            Listo
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
