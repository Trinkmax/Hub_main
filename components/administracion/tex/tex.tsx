'use client'

import { AnimatePresence } from 'motion/react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { admFabFromFrame } from '../nav/adm-nav-model'
import { TexDock } from './tex-dock'
import { TexGuide } from './tex-guide'
import { TexPanel } from './tex-panel'
import { TexProvider, useTex } from './tex-provider'

function TexStage() {
  const { open, slug, pathname } = useTex()
  // En el celular, las pantallas de tarea tienen su pie fijo: Tex no se le para encima.
  const roomOnPhone = admFabFromFrame(`/${slug}/administracion`, pathname)
  return (
    <>
      <AnimatePresence>
        {open ? <TexPanel key="panel" /> : <TexDock key="dock" roomOnPhone={roomOnPhone} />}
      </AnimatePresence>
      <TexGuide />
    </>
  )
}

/**
 * Tex en Administración. Va en un portal: queda fuera de `<main>`, así lo que Tex «ve» de la pantalla
 * es lo que ve la persona, sin él adentro.
 */
export function Tex({ slug, isAccountant }: { slug: string; isAccountant: boolean }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(
    <TexProvider slug={slug} isAccountant={isAccountant}>
      <TexStage />
    </TexProvider>,
    document.body,
  )
}
