'use client'

import { X } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
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

const DISMISS_PX = 110 // px de arrastre hacia abajo para cerrar
const DISMISS_VELOCITY = 0.5 // px/ms (≈ flick rápido)
const SNAP_MS = 320
const DRAWER_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)' // curva drawer iOS

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
 * Cuerpo del sheet de la wallet.
 *
 * IMPORTANTE (iOS): NO usamos transforms persistentes. Un `transform` en reposo
 * promueve el subárbol a una capa compositada y iOS Safari rasteriza la serif fina
 * (Fraunces) lavada/fantasma. Por eso:
 *  - El colapso del header es por scroll natural + opacidad CSS (sin transform).
 *  - El gesto de arrastre aplica `translateY` por ref SÓLO mientras arrastrás y lo
 *    quita al soltar → en reposo no hay capa y el texto queda nítido.
 *
 * Arrastrar para cerrar se dispara desde el asa o desde CUALQUIER parte de arriba:
 * si el scroll está en el tope y tirás hacia abajo, baja todo el sheet y cierra.
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
  const sheetRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  // Colapso por scroll: el header grande scrollea natural; la barra compacta aparece.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setCollapsed(el.scrollTop > 48)
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Pull-to-dismiss (touch). Transform aplicado sólo durante el gesto.
  useEffect(() => {
    const sheet = sheetRef.current
    const scroller = scrollRef.current
    if (!sheet || !scroller) return

    let startY = 0
    let lastY = 0
    let lastT = 0
    let velocity = 0
    let active = false // toque en curso
    let pulling = false // confirmado como arrastre de cierre
    let snapTimer = 0

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      if (!t) return
      window.clearTimeout(snapTimer)
      startY = lastY = t.clientY
      lastT = e.timeStamp
      velocity = 0
      active = true
      pulling = false
    }

    const onMove = (e: TouchEvent) => {
      if (!active) return
      const t = e.touches[0]
      if (!t) return
      const dy = t.clientY - startY
      if (!pulling) {
        // Decidir scroll vs cierre: sólo cierra si estás arriba de todo y tirás hacia abajo.
        if (dy > 6 && scroller.scrollTop <= 0) {
          pulling = true
          sheet.style.willChange = 'transform'
        } else if (dy < -2 || scroller.scrollTop > 0) {
          active = false // es scroll normal → soltamos el control
          return
        } else {
          return
        }
      }
      e.preventDefault() // frena el overscroll/rubber-band nativo
      velocity = (t.clientY - lastY) / Math.max(1, e.timeStamp - lastT)
      lastY = t.clientY
      lastT = e.timeStamp
      sheet.style.transition = 'none'
      sheet.style.transform = `translateY(${Math.max(0, dy)}px)`
    }

    const settle = (toClose: boolean) => {
      sheet.style.transition = `transform ${SNAP_MS}ms ${DRAWER_EASE}`
      sheet.style.transform = toClose ? 'translateY(100%)' : 'translateY(0px)'
      if (toClose) {
        window.setTimeout(onClose, SNAP_MS - 40)
      } else {
        // Al volver al reposo, SACAMOS el transform (sin capa compositada → serif nítida).
        snapTimer = window.setTimeout(() => {
          sheet.style.transition = ''
          sheet.style.transform = ''
          sheet.style.willChange = ''
        }, SNAP_MS)
      }
    }

    const onEnd = () => {
      if (!active) return
      active = false
      if (!pulling) return
      pulling = false
      const dy = lastY - startY
      settle(dy > DISMISS_PX || velocity > DISMISS_VELOCITY)
    }

    sheet.addEventListener('touchstart', onStart, { passive: true })
    sheet.addEventListener('touchmove', onMove, { passive: false })
    sheet.addEventListener('touchend', onEnd, { passive: true })
    sheet.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.clearTimeout(snapTimer)
      sheet.removeEventListener('touchstart', onStart)
      sheet.removeEventListener('touchmove', onMove)
      sheet.removeEventListener('touchend', onEnd)
      sheet.removeEventListener('touchcancel', onEnd)
    }
  }, [onClose])

  return (
    <div
      ref={sheetRef}
      className="bg-app-gradient relative flex h-full flex-col overflow-hidden rounded-t-3xl"
    >
      {/* CHROME superior fijo: asa + barra compacta (aparece al scrollear) + cerrar.
          pointer-events-none para no tapar el gesto/scroll del cuerpo. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30">
        {/* Fondo blur SÓLO cuando está colapsado (evita compositar en reposo). */}
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 transition-opacity duration-200',
            collapsed
              ? 'border-b border-border/60 bg-background/80 opacity-100 backdrop-blur-md'
              : 'opacity-0',
          )}
        />
        <div className="relative pt-[max(env(safe-area-inset-top),10px)]">
          <div aria-hidden className="mx-auto h-1.5 w-10 rounded-full bg-foreground/25" />
          <div
            aria-hidden={!collapsed}
            className={cn(
              'mt-2 flex items-center gap-2 pb-2.5 pl-4 pr-14 pt-1 transition-opacity duration-200',
              collapsed ? 'opacity-100' : 'opacity-0',
            )}
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
          </div>
        </div>
      </div>

      {/* CERRAR — siempre visible. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="pointer-events-auto absolute right-3.5 top-[max(env(safe-area-inset-top),10px)] z-40 flex size-9 items-center justify-center rounded-full bg-foreground/10 text-foreground/70 backdrop-blur-sm transition-colors hover:bg-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
      >
        <X className="size-5" />
      </button>

      {/* CUERPO scrolleable. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* Header de identidad grande (texto plano, sin transform → nítido). */}
        <header className="mx-auto flex max-w-md flex-col items-center px-4 pb-1 pt-[calc(env(safe-area-inset-top)+4rem)] text-center">
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
        </header>

        {children}

        <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
      </div>
    </div>
  )
}

/**
 * Sheet full-screen de la wallet del cliente. El cuerpo (WalletShell embebido)
 * llega como `children`; el chrome reactivo al scroll y el gesto de cierre viven
 * en `WalletSheetBody` (ver nota sobre iOS/serif ahí).
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
