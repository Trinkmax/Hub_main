'use client'

import { AnimatePresence } from 'motion/react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TenantRole } from '@/lib/tenant/types'
import { TexDock } from './tex-dock'
import { TexGuide } from './tex-guide'
import { TexPanel } from './tex-panel'
import { TexProvider, useTex } from './tex-provider'

function TexStage() {
  const { open, pointing, guide } = useTex()
  return (
    <>
      <AnimatePresence>
        {open ? (
          <TexPanel key="panel" />
        ) : pointing || guide ? null : (
          // Mientras señala, Tex está parado al lado de lo que muestra: no hay dos.
          <TexDock key="dock" />
        )}
      </AnimatePresence>
      <TexGuide />
    </>
  )
}

/**
 * Tex en todo el panel de gestión. Va en un portal: queda fuera de `<main>`, así lo que Tex «ve» de la pantalla
 * es lo que ve la persona, sin él adentro.
 */
export function Tex({
  slug,
  role,
  canAttach,
}: {
  slug: string
  role: TenantRole
  canAttach: boolean
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(
    <TexProvider slug={slug} role={role} canAttach={canAttach}>
      <TexStage />
    </TexProvider>,
    document.body,
  )
}
