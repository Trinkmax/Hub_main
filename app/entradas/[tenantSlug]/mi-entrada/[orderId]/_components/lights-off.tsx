'use client'

import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { formatShortCode } from '@/lib/ticketing/door'
import type { TicketQr } from '@/lib/ticketing/ticket-art'
import { TicketQrArt } from './ticket-qr-art'

/**
 * «Se apagan las luces»: el QR a pantalla completa para mostrar en la puerta.
 * Toda la pantalla a oscuras y lo único prendido es el QR, como una sala cuando
 * empieza la función. La pantalla no se apaga sola mientras está abierto.
 */
export function LightsOff({
  open,
  onClose,
  qr,
  title,
  firstName,
  partySize,
  shortCode,
}: {
  open: boolean
  onClose: () => void
  qr: TicketQr
  title: string
  firstName: string
  partySize: number
  shortCode: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  // Que el celular no se bloquee mientras muestran el QR. Donde no se puede
  // (o lo niegan por batería baja), sigue funcionando igual.
  useEffect(() => {
    if (!open || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const request = async () => {
      try {
        const next = await navigator.wakeLock.request('screen')
        if (cancelled) void next.release()
        else lock = next
      } catch {
        // Sin bloqueo de pantalla: nada que hacer.
      }
    }
    void request()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [open])

  return (
    <dialog
      ref={dialog}
      className="ent-lights"
      aria-label={`QR de tu entrada para ${title}`}
      onClose={onClose}
    >
      {open ? (
        <div className="relative isolate flex h-full flex-col items-center justify-center gap-5 overflow-hidden px-4 py-6 text-center">
          <div className="ent-beam" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            className="ent-press absolute top-[max(1rem,env(safe-area-inset-top))] right-4 flex size-12 items-center justify-center rounded-full bg-white/10 text-(--ent-cream)"
            aria-label="Cerrar y volver a la entrada"
          >
            <X className="size-5" aria-hidden />
          </button>

          <p className="ent-display max-w-[22rem] text-[2.4rem] text-balance">{title}</p>
          <div className="ent-lights-screen">
            <TicketQrArt qr={qr} label={`Código QR de tu entrada para ${title}`} />
          </div>
          <div>
            <p className="text-lg font-semibold">
              {firstName} · Admite {partySize}
            </p>
            <p className="ent-mono mt-1 text-xs text-(--ent-gold)">{formatShortCode(shortCode)}</p>
          </div>
          <p className="max-w-[20rem] text-sm text-(--ent-muted)">
            Si no lo lee, subí el brillo del celular.
          </p>
        </div>
      ) : null}
    </dialog>
  )
}
