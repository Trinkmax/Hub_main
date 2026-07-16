import type { ReactNode } from 'react'

export type TourStep = {
  id: string
  /** Selector CSS del elemento a iluminar — convención: [data-tour="…"]. */
  target?: string
  /** Etiqueta chica arriba del título (default: "Paso N de M"). */
  kicker?: string
  title: string
  body: ReactNode
  /**
   * Mini-demo visual (mock NO interactivo) que MUESTRA la acción en vez de solo
   * describirla — clave en pasos centrados donde no hay elemento real que
   * iluminar (el panel rápido vive en un popup, el uploader en un dialog…).
   */
  demo?: ReactNode
  /** Si el target no está montado, mostrar la tarjeta centrada en vez de saltear el paso. */
  fallbackCentered?: boolean
}

export type TourDefinition = {
  /** Clave de persistencia (localStorage hub:tour:{id}). */
  id: string
  /** Nombre humano (aria-label y botón de relanzar). */
  title: string
  steps: TourStep[]
}
