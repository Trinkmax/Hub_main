'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react'
import { type ReactNode, useRef } from 'react'
import { cn } from '@/lib/utils'
import './mobile.css'

/**
 * Una hoja de vidrio como las de iOS 26: flota a unos milímetros de los bordes, con las esquinas tan
 * redondas como las de la pantalla, sube con un resorte y se baja con el dedo desde la barrita de arriba.
 *
 * Es un `Dialog` de Radix (foco atrapado, Esc, lector de pantalla) con la animación de `motion`. Al
 * abrir NO enfoca el primer campo: en el celular eso abriría el teclado sin que nadie lo pida.
 */
export function AppSheet({
  open,
  onOpenChange,
  title,
  description,
  headerAction,
  children,
  className,
  bodyClassName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Para lectores de pantalla (no se muestra). */
  description: string
  /** Un botón chico al lado del título (por ejemplo «Editar»). */
  headerAction?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  const drag = useDragControls()
  const reduced = useReducedMotion()
  const sheetRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="app-sheet-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                sheetRef.current?.focus()
              }}
            >
              <motion.div
                ref={sheetRef}
                tabIndex={-1}
                className={cn('app-sheet', className)}
                initial={reduced ? { opacity: 0 } : { y: '110%' }}
                animate={reduced ? { opacity: 1 } : { y: 0 }}
                exit={reduced ? { opacity: 0 } : { y: '110%' }}
                transition={
                  reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 38 }
                }
                drag={reduced ? false : 'y'}
                dragListener={false}
                dragControls={drag}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.04, bottom: 0.85 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 110 || info.velocity.y > 650) onOpenChange(false)
                }}
              >
                {/* Desde acá se agarra la hoja: el resto scrollea por adentro. */}
                <div className="app-sheet-handle" onPointerDown={(event) => drag.start(event)}>
                  <span aria-hidden className="app-sheet-grabber" />
                  <div className="app-sheet-header">
                    <Dialog.Title className="app-sheet-title">{title}</Dialog.Title>
                    {headerAction}
                    <Dialog.Close className="app-sheet-close" aria-label="Cerrar">
                      <X aria-hidden className="size-[18px]" strokeWidth={2.4} />
                    </Dialog.Close>
                  </div>
                </div>
                <Dialog.Description className="sr-only">{description}</Dialog.Description>
                <div className={cn('app-sheet-body', bodyClassName)}>{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}
