'use client'

import { TexSprite, useTexFace } from '@/components/administracion/tex/tex-sprite'

/**
 * La cara de Tex en el círculo de la barra (el lugar del «Buscar» de iOS 26): su cabeza en píxeles, que
 * parpadea cada tanto. Va sola, sin el proveedor de Tex (que vive en su propio portal): el círculo solo
 * lo abre con `openTex()`.
 */
export function TexOrbFace() {
  const face = useTexFace({ talking: false, mood: 'listening' })
  return <TexSprite pose="head" face={face} scale={1} className="tex-orb-head" />
}
