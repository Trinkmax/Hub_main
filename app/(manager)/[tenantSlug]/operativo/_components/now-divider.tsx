'use client'

import { motion } from 'motion/react'
import { Badge } from '@/components/ui/badge'

/**
 * La línea de "ahora" en la lista: lo de arriba ya tendría que haber llegado,
 * lo de abajo viene. Estática a propósito (nada late acá: el único punto que
 * respira en la pantalla es el de "en vivo"). Es un `motion.li` para poder
 * convivir con las filas dentro del mismo AnimatePresence.
 *
 * La etiqueta es la marca sólida del kit (`brand` sólida): es el «estás acá»
 * en el tiempo.
 */
export function NowDivider({ label }: { label: string | null }) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      aria-label={`Ahora, ${label ?? ''}`}
      className="relative my-1 flex items-center gap-2 py-1"
      data-now-marker
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
      <span aria-hidden="true" className="h-0.5 flex-1 rounded-full bg-primary" />
      <Badge tone="brand" appearance="solid" className="type-amount">
        Ahora{label ? ` · ${label}` : ''}
      </Badge>
    </motion.li>
  )
}
