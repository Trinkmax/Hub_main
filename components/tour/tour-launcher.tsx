'use client'

import { HelpCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { TenantRole } from '@/lib/tenant/types'
import { GuidedTour } from './guided-tour'
import type { TourDefinition } from './types'

const doneKey = (id: string) => `hub:tour:${id}`

function isTourDone(id: string): boolean {
  try {
    return window.localStorage.getItem(doneKey(id)) === 'done'
  } catch {
    return true // sin storage no auto-lanzamos (evita loops en cada visita)
  }
}

function markTourDone(id: string): void {
  try {
    window.localStorage.setItem(doneKey(id), 'done')
  } catch {
    // sin storage, no persistimos
  }
}

/**
 * Botón "¿Cómo funciona?" que abre un tour guiado, y auto-lanzamiento en la
 * primera visita para los roles indicados (p. ej. el tour de la carta se abre
 * solo para la diseñadora la primera vez que entra a /menu). Cerrarlo — por X
 * o completándolo — lo marca visto; siempre se puede volver a abrir desde acá.
 */
export function TourLauncher({
  tour,
  currentRole,
  autoStartForRoles = [],
  className,
}: {
  tour: TourDefinition
  currentRole: TenantRole
  autoStartForRoles?: TenantRole[]
  className?: string
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!autoStartForRoles.includes(currentRole)) return
    if (isTourDone(tour.id)) return
    // Pequeño delay: deja pintar la página antes de oscurecerla.
    const t = window.setTimeout(() => setOpen(true), 700)
    return () => window.clearTimeout(t)
  }, [autoStartForRoles, currentRole, tour.id])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={className}
        data-tour-launcher={tour.id}
      >
        <HelpCircle className="size-4" aria-hidden />
        ¿Cómo funciona?
      </Button>
      <GuidedTour
        tour={tour}
        open={open}
        onClose={() => {
          markTourDone(tour.id)
          setOpen(false)
        }}
      />
    </>
  )
}
