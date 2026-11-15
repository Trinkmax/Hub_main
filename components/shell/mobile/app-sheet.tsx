'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import './mobile.css'

/** Al soltarla, se cierra si bajó al menos esto… */
const CLOSE_DISTANCE_PX = 110
/** …o si iba bajando a esta velocidad (px por milisegundo: un «tirón» corto también la cierra). */
const CLOSE_SPEED = 0.55
/** Cuánto hay que mover el dedo para saber si el gesto es de la hoja o de la lista. */
const SLOP_PX = 6

/**
 * Una hoja de vidrio como las de iOS 26: flota a unos milímetros de los bordes, con las esquinas tan
 * redondas como las de la pantalla y sube con un resorte.
 *
 * **Se baja con el dedo desde cualquier parte**, como en iOS. Si el contenido está arriba de todo, tirar
 * hacia abajo arrastra la hoja; si ya estaba corrido, el dedo corre la lista (y una vez arriba, se puede
 * bajar). Al soltar se cierra si bajó lo suficiente o con un tirón rápido; si no, vuelve a su lugar con un
 * resorte. El fondo se aclara a medida que baja. Con el mouse, se agarra de la barrita de arriba.
 *
 * Es un `Dialog` de Radix (foco atrapado, Esc, la ✕, lector de pantalla) con la animación de `motion`. Al
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
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // El portal de Radix monta la hoja un instante después de abrir: el gesto se engancha cuando la hoja
  // existe de verdad (con un efecto atado a `open`, todavía no estaba).
  const [sheetEl, setSheetEl] = useState<HTMLDivElement | null>(null)
  const attachSheet = useCallback((node: HTMLDivElement | null) => {
    sheetRef.current = node
    setSheetEl(node)
  }, [])
  // Dónde está la hoja (0 = en su lugar). Lo mueven la entrada, la salida y el dedo.
  const y = useMotionValue(0)
  // El fondo se aclara a medida que la hoja baja: se ve que se está yendo. Mientras entra o sale (`y` en
  // porcentaje) manda el fundido del fondo, no esto.
  const dim = useTransform(y, (value: number | string) =>
    typeof value === 'number' ? Math.max(0.2, 1 - Math.max(0, value) / 475) : 1,
  )
  const closeRef = useRef(onOpenChange)
  closeRef.current = onOpenChange

  // Bajarla con el dedo desde cualquier parte. Va con eventos táctiles nativos (no los de React, que son
  // pasivos): hay que poder frenar el scroll y el rebote de Safari cuando el gesto es de la hoja.
  useEffect(() => {
    const sheet = sheetEl
    if (reduced || !sheet) return
    let mode: 'idle' | 'undecided' | 'drag' | 'native' = 'idle'
    let startX = 0
    let startY = 0
    let lastY = 0
    let lastT = 0
    let speed = 0

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || event.touches.length > 1) {
        mode = 'native'
        return
      }
      startX = touch.clientX
      startY = lastY = touch.clientY
      lastT = event.timeStamp
      speed = 0
      const body = bodyRef.current
      const inBody = body?.contains(event.target as Node) ?? false
      // Con la lista corrida, el dedo la corre a ella.
      mode = inBody && (body?.scrollTop ?? 0) > 0 ? 'native' : 'undecided'
    }

    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      if (mode === 'undecided') {
        const dy = touch.clientY - startY
        const dx = touch.clientX - startX
        if (dy > 0 && dy >= Math.abs(dx)) {
          // Hacia abajo y arriba de todo: el gesto es de la hoja (sin el rebote de Safari).
          event.preventDefault()
          if (dy > SLOP_PX) {
            mode = 'drag'
            startY = touch.clientY
          }
          return
        }
        if (Math.abs(dy) > SLOP_PX || Math.abs(dx) > SLOP_PX) mode = 'native'
        return
      }
      if (mode !== 'drag') return
      event.preventDefault()
      const offset = touch.clientY - startY
      // Para arriba casi no sube: se nota el tope.
      y.set(offset > 0 ? offset : offset * 0.15)
      speed = (touch.clientY - lastY) / Math.max(1, event.timeStamp - lastT)
      lastY = touch.clientY
      lastT = event.timeStamp
    }

    const onEnd = () => {
      if (mode === 'drag') {
        if (y.get() > CLOSE_DISTANCE_PX || speed > CLOSE_SPEED) closeRef.current(false)
        else animate(y, 0, { type: 'spring', stiffness: 520, damping: 42 })
      }
      mode = 'idle'
    }

    sheet.addEventListener('touchstart', onStart, { passive: true })
    sheet.addEventListener('touchmove', onMove, { passive: false })
    sheet.addEventListener('touchend', onEnd)
    sheet.addEventListener('touchcancel', onEnd)
    return () => {
      sheet.removeEventListener('touchstart', onStart)
      sheet.removeEventListener('touchmove', onMove)
      sheet.removeEventListener('touchend', onEnd)
      sheet.removeEventListener('touchcancel', onEnd)
    }
  }, [sheetEl, reduced, y])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="app-sheet-overlay-wrap"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
              >
                <motion.div className="app-sheet-overlay" style={{ opacity: dim }} />
              </motion.div>
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
                ref={attachSheet}
                tabIndex={-1}
                className={cn('app-sheet', className)}
                style={{ y }}
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
                  if (info.offset.y > CLOSE_DISTANCE_PX || info.velocity.y > 650)
                    onOpenChange(false)
                }}
              >
                {/* Con el mouse se agarra de acá; con el dedo, de cualquier parte (ver el efecto de arriba). */}
                <div
                  className="app-sheet-handle"
                  onPointerDown={(event) => {
                    if (event.pointerType === 'mouse') drag.start(event)
                  }}
                >
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
                <div ref={bodyRef} className={cn('app-sheet-body', bodyClassName)}>
                  {children}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}
