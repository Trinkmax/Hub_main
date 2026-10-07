'use client'

import { redirect, useSelectedLayoutSegment } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Antes de la puesta en marcha, el dueño que la puede hacer solo ve el
 * asistente: cualquier otra pantalla de la sección lo lleva a `/configurar`.
 * Es un componente de cliente porque el layout no conoce la sub-ruta; en la
 * primera carga `redirect` corre en el SSR y es una redirección del servidor.
 */
export function SetupGate({
  configurarHref,
  children,
}: {
  configurarHref: string
  children: ReactNode
}) {
  const segment = useSelectedLayoutSegment()
  if (segment !== 'configurar') redirect(configurarHref)
  return <>{children}</>
}
