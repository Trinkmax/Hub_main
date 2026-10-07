'use client'

import { Maximize2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * El QR que el mozo le da vuelta al cliente para que se sume al club.
 *
 * Decisiones que vienen del mostrador, no de la estética:
 *
 * - Fondo BLANCO puro y QR negro, no los tokens crema/forest de la marca: un
 *   lector de QR necesita contraste real, y el crema sobre pantalla con brillo
 *   bajo hace fallar el escaneo desde 40cm.
 * - El SVG viene inline en el HTML desde el server. Cero requests para dibujarlo
 *   → con el service worker sirviendo el shell desde cache, esta pantalla se abre
 *   y se ve completa aunque el celular no tenga señal.
 * - Wake lock mientras está en pantalla completa: el teléfono se apagaba justo
 *   mientras el cliente buscaba la cámara. No existe API web para subir el
 *   brillo, así que eso queda a mano (y lo decimos, no lo prometemos).
 */
export function ClubQrStage({
  qrSvg,
  tenantName,
  clubUrl,
}: {
  qrSvg: string
  tenantName: string
  clubUrl: string
}) {
  const [full, setFull] = useState(false)
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)

  const releaseLock = useCallback(async () => {
    try {
      await wakeLock.current?.release()
    } catch {
      // El lock ya se soltó solo (pestaña en background). Nada que hacer.
    }
    wakeLock.current = null
  }, [])

  useEffect(() => {
    if (!full) {
      void releaseLock()
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
        }
        const lock = await nav.wakeLock?.request('screen')
        if (cancelled) {
          await lock?.release()
          return
        }
        wakeLock.current = lock ?? null
      } catch {
        // Sin soporte o denegado: la pantalla se apaga como siempre, no rompe nada.
      }
    })()
    return () => {
      cancelled = true
      void releaseLock()
    }
  }, [full, releaseLock])

  // Cerrar con el botón físico de atrás en Android en vez de salir del panel.
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  const qr = (
    <div
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generado en el server por `qrcode`, sin input de usuario
      dangerouslySetInnerHTML={{ __html: qrSvg }}
      className="[&>svg]:h-auto [&>svg]:w-full"
      role="img"
      aria-label={`Código QR para sumarse al club de ${tenantName}`}
    />
  )

  return (
    <>
      <div className="space-y-3">
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-white shadow-sm">
          <div className="px-5 pt-5 text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500">
              Club de beneficios
            </p>
            <p className="mt-0.5 font-display text-xl font-semibold text-neutral-900">
              {tenantName}
            </p>
          </div>
          <div className="p-5">{qr}</div>
          <p className="px-6 pb-6 text-center text-sm text-neutral-600 text-balance">
            Escaneá y sumate: cada consumo te da puntos y beneficios.
          </p>
        </div>

        <Button size="xl" className="h-14 w-full gap-2" onClick={() => setFull(true)}>
          <Maximize2 className="size-5" aria-hidden />
          Pantalla completa
        </Button>

        <p className="text-center text-xs text-muted-foreground text-balance">
          Subí el brillo del teléfono antes de mostrarlo. Funciona sin señal.
        </p>
      </div>

      {/* Escenario a pantalla completa: sin topbar, sin tabs, sin nada que tocar
          por error mientras el teléfono está en manos del cliente. */}
      <div
        aria-hidden={!full}
        className={cn(
          'fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-6 transition-opacity duration-[var(--duration-base)]',
          full ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <p className="font-display text-2xl font-semibold text-neutral-900">{tenantName}</p>
        <div className="w-full max-w-sm">{qr}</div>
        <p className="max-w-xs text-center text-base text-neutral-600 text-balance">
          Escaneá y sumate al club
        </p>
        <Button
          variant="outline"
          size="xl"
          onClick={() => setFull(false)}
          className="absolute right-4 top-[calc(env(safe-area-inset-top)+1rem)] size-12 rounded-full border-neutral-300 p-0 text-neutral-700 hover:bg-neutral-100"
          aria-label="Cerrar pantalla completa"
          tabIndex={full ? 0 : -1}
        >
          <X className="size-6" aria-hidden />
        </Button>
        <p className="absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] max-w-xs break-all text-center font-mono text-[10px] text-neutral-400">
          {clubUrl}
        </p>
      </div>
    </>
  )
}
