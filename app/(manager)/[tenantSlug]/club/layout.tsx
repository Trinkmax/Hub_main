import type { ReactNode } from 'react'

/**
 * El editor del Club se unificó en /menu (mundo "Club"): todas las viejas rutas
 * /club/* ahora redirigen ahí. Lo único que queda bajo /club es el simulador de
 * wallet (herramienta aparte, con su propio guard owner-only). Este layout es un
 * wrapper mínimo de ancho — sin sub-nav, para no duplicar la navegación de /menu.
 */
export default function ClubLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
  )
}
