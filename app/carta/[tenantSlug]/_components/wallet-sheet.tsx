'use client'

import { X } from 'lucide-react'
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'motion/react'
import Image from 'next/image'
import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useDismissOnBack } from './use-dismiss-on-back'

/** Datos mínimos para el header del sheet (el cuerpo llega pre-renderizado en `children`). */
export type WalletSummary = {
  tenantName: string
  logoUrl: string | null
  firstName: string
  tierName: string | null
  tierColor: string | null
}

// Umbrales del gesto de cierre (px / px·s⁻¹). Tirar > 120px o flickear > 500px/s cierra.
const DISMISS_OFFSET = 120
const DISMISS_VELOCITY = 500
// Curva drawer iOS (Ionic / Vaul) para el spring-back y el cierre.
const EASE_DRAWER = [0.32, 0.72, 0, 1] as const

/** Chip compacto del nivel: usa el color del nivel si es hex, sino el acento de marca. */
function TierChip({ name, color }: { name: string; color: string | null }): React.JSX.Element {
  const isHex = color !== null && /^#[0-9a-fA-F]{6}$/.test(color)
  return (
    <span
      style={isHex ? { backgroundColor: color, color: '#fff' } : undefined}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        !isHex &&
          'bg-[--brand-accent,var(--primary)] text-[--brand-accent-foreground,var(--primary-foreground)]',
      )}
    >
      {name}
    </span>
  )
}

/**
 * Cuerpo del sheet (vive DENTRO de `SheetContent`, que Radix portaliza y sólo
 * monta cuando `open`). Por eso los hooks de motion —en especial
 * `useScroll({ container })`— sólo corren con el contenedor ya montado e
 * hidratado, evitando el error "container ref defined but not hydrated".
 */
function WalletSheetBody({
  summary,
  onClose,
  children,
}: {
  summary: WalletSummary
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const reduce = useReducedMotion()
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()
  const y = useMotionValue(0)
  const { scrollY } = useScroll({ container: scrollRef })

  // `collapsed` sólo gobierna estados booleanos (aria); el fade lo maneja motion.
  const [collapsed, setCollapsed] = useState(false)
  useMotionValueEvent(scrollY, 'change', (v) => setCollapsed(v > 60))

  // Colapso al scroll. Con reduced-motion conservamos el crossfade de opacidad
  // y quitamos el movimiento/scale (Emil: menos movimiento, no cero animación).
  const heroOpacity = useTransform(scrollY, [0, 90], [1, 0])
  const heroY = useTransform(scrollY, [0, 90], [0, reduce ? 0 : -16])
  const heroScale = useTransform(scrollY, [0, 90], [1, reduce ? 1 : 0.97])
  const compactOpacity = useTransform(scrollY, [44, 104], [0, 1])

  const startDrag = (e: ReactPointerEvent) => dragControls.start(e)

  const dismiss = () => {
    if (reduce) {
      onClose()
      return
    }
    const h = typeof window !== 'undefined' ? window.innerHeight : 1000
    void animate(y, h, { duration: 0.28, ease: EASE_DRAWER }).then(onClose)
  }

  return (
    <motion.div
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0 }}
      dragElastic={{ top: 0.08, bottom: 0 }}
      dragMomentum={false}
      onDragEnd={(_, info) => {
        if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) dismiss()
        else void animate(y, 0, { type: 'spring', stiffness: 520, damping: 44, restDelta: 0.5 })
      }}
      style={{ y }}
      className="bg-app-gradient relative flex h-full flex-col overflow-hidden rounded-t-3xl"
    >
      {/* CHROME superior fijo = zona de arrastre (asa + barra compacta). */}
      <div
        onPointerDown={startDrag}
        className="absolute inset-x-0 top-0 z-30 touch-none select-none"
      >
        {/* Fondo blur de toda la barra: aparece al scrollear y tapa el contenido
            que pasa por debajo (incluida la zona del asa). */}
        <motion.div
          aria-hidden
          style={{ opacity: compactOpacity }}
          className="absolute inset-0 border-b border-border/60 bg-background/80 backdrop-blur-md"
        />
        <div className="relative pt-[max(env(safe-area-inset-top),10px)]">
          <div aria-hidden className="mx-auto h-1.5 w-10 rounded-full bg-foreground/25" />

          {/* Marca + nivel: aparece al scrollear (el nombre ya vive en el header grande). */}
          <motion.div
            style={{ opacity: compactOpacity }}
            aria-hidden={!collapsed}
            className="mt-2 flex items-center gap-2 pb-2.5 pl-4 pr-14 pt-1"
          >
            {summary.logoUrl ? (
              <Image
                src={summary.logoUrl}
                alt={summary.tenantName}
                width={120}
                height={28}
                className="h-6 w-auto max-w-[140px] shrink-0 object-contain"
                unoptimized
              />
            ) : (
              <span className="min-w-0 truncate font-serif text-base font-semibold tracking-tight">
                {summary.tenantName}
              </span>
            )}
            <span className="flex-1" />
            {summary.tierName ? (
              <TierChip name={summary.tierName} color={summary.tierColor} />
            ) : null}
          </motion.div>
        </div>
      </div>

      {/* CERRAR — siempre visible (hermano del chrome → no inicia drag). */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="absolute right-3.5 top-[max(env(safe-area-inset-top),10px)] z-40 flex size-9 items-center justify-center rounded-full bg-foreground/10 text-foreground/70 backdrop-blur-sm transition-colors hover:bg-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
      >
        <X className="size-5" />
      </button>

      {/* CUERPO scrolleable */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* Header de identidad grande: se "sale" al scrollear. */}
        <motion.header
          style={{ opacity: heroOpacity, y: heroY, scale: heroScale }}
          className="mx-auto flex max-w-md flex-col items-center px-4 pb-1 pt-[calc(env(safe-area-inset-top)+4rem)] text-center"
        >
          {summary.logoUrl ? (
            <Image
              src={summary.logoUrl}
              alt={summary.tenantName}
              width={96}
              height={96}
              className="h-12 w-auto max-w-[160px] object-contain"
              unoptimized
              priority
            />
          ) : (
            <p className="font-serif text-xl font-semibold tracking-tight">{summary.tenantName}</p>
          )}
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">
            Hola, {summary.firstName}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Tu billetera de beneficios</p>
        </motion.header>

        {children}

        <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
      </div>
    </motion.div>
  )
}

/**
 * Sheet full-screen de la wallet del cliente. El cuerpo (WalletShell embebido)
 * llega como `children`; el "chrome" reactivo al scroll y el gesto de arrastre
 * viven en `WalletSheetBody`:
 *
 *  - Full-screen (`h-[100dvh]`) → no deja ver el header de la carta detrás.
 *  - Header de identidad grande que se DESVANECE y sube al scrollear, mientras
 *    una barra compacta con blur aparece arriba (patrón iOS de título grande).
 *  - Arrastrar para cerrar: se inicia sólo desde el asa/barra superior
 *    (`dragListener={false}` + `useDragControls`) para no pelear con el scroll
 *    interno. Cierra por umbral de distancia o velocidad, con spring-back.
 */
export function WalletSheet({
  open,
  onClose,
  summary,
  children,
}: {
  open: boolean
  onClose: () => void
  summary: WalletSummary
  children: React.ReactNode
}): React.JSX.Element {
  useDismissOnBack(open, onClose)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className="force-light h-[100dvh] gap-0 overflow-hidden rounded-t-3xl border-t-0 bg-transparent p-0"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">Mi billetera</SheetTitle>
        <WalletSheetBody summary={summary} onClose={onClose}>
          {children}
        </WalletSheetBody>
      </SheetContent>
    </Sheet>
  )
}
