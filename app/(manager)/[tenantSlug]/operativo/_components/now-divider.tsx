'use client'

import { motion } from 'motion/react'

/**
 * La línea de "ahora" en la lista: lo de arriba ya tendría que haber llegado,
 * lo de abajo viene. Estática a propósito (nada late acá: el único punto que
 * respira en la pantalla es el de "en vivo"). Es un `motion.li` para poder
 * convivir con las filas dentro del mismo AnimatePresence.
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
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-primary ring-4 ring-primary/15"
      />
      <span aria-hidden className="h-0.5 flex-1 rounded-full bg-primary/70" />
      <span className="rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary-foreground tabular-nums">
        ahora{label ? ` · ${label}` : ''}
      </span>
    </motion.li>
  )
}
