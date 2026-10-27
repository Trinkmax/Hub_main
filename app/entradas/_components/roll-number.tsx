'use client'

import { useState } from 'react'

/**
 * Un valor que, al cambiar, entra rodando: desde abajo si sube, desde arriba
 * si baja (personas, el total). El viejo se va sin animación: es un contador,
 * no un carrusel.
 */
export function RollNumber({
  value,
  rank,
  className,
}: {
  value: string
  /** Para decidir la dirección (el número detrás del texto). */
  rank: number
  className?: string
}) {
  // Estado derivado del render anterior (patrón de React para «el valor de
  // antes»): un ref mutado en el render se rompe con el doble render de dev.
  const [last, setLast] = useState(rank)
  const [dir, setDir] = useState<'up' | 'down'>('up')
  if (rank !== last) {
    setDir(rank > last ? 'up' : 'down')
    setLast(rank)
  }
  return (
    <span className={className}>
      <span key={value} className="ent-roll-in" data-dir={dir}>
        {value}
      </span>
    </span>
  )
}
