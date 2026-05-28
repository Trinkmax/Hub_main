'use client'

import { Clock, ScanLine } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { subscribeChanges } from '@/lib/realtime/subscribe'

const POLL_INTERVAL_MS = 30_000

export function WaitingForWaiter({
  physicalTableId,
  tableLabel,
  tenantName,
}: {
  physicalTableId: string
  tableLabel: string
  tenantName: string
}) {
  const router = useRouter()

  useEffect(() => {
    const cleanup = subscribeChanges({
      channel: `pt-${physicalTableId}`,
      events: [
        {
          event: 'INSERT',
          table: 'table_sessions',
          filter: `physical_table_id=eq.${physicalTableId}`,
          onChange: () => router.refresh(),
        },
      ],
    })

    // Safety net: refrescar el server component cada 30s por si realtime no llegó.
    const interval = window.setInterval(() => {
      router.refresh()
    }, POLL_INTERVAL_MS)

    return () => {
      cleanup()
      window.clearInterval(interval)
    }
  }, [physicalTableId, router])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12 text-center">
      <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {tenantName}
      </div>
      <h1 className="mb-8 font-serif text-3xl font-semibold tracking-tight">{tableLabel}</h1>

      <div className="mb-6 flex size-20 items-center justify-center rounded-full border border-primary/20 bg-[--cream-tint] text-primary shadow-2xs">
        <Clock className="size-9" aria-hidden />
      </div>

      <p className="mb-2 font-serif text-xl font-semibold">Esperá a que el mozo active la mesa</p>
      <p className="max-w-sm text-balance text-sm text-muted-foreground">
        Cuando el mozo escanee este código y te confirme la mesa, vas a poder ver la carta y pedir
        desde tu celular.
      </p>

      <div className="mt-10 flex items-center gap-2 text-xs text-muted-foreground">
        <ScanLine className="size-3.5" aria-hidden />
        <span>Mostrale el QR al mozo si todavía no lo escaneó.</span>
      </div>
    </div>
  )
}
