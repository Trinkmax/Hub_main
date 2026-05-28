'use client'

import { ScanLine, SquarePlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { activateTableByIdAction, activateTableByQrAction } from '@/lib/sessions-waiter/actions'
import type { SalonOccupancy, SalonTableRow } from '@/lib/sessions-waiter/queries'
import { ManualActivateSheet } from './manual-activate-sheet'
import { OccupancyBanner } from './occupancy-banner'
import { PartySizeStepper } from './party-size-stepper'
import { QrScannerSheet } from './qr-scanner-sheet'
import { SalonTablesGrid } from './salon-tables-grid'

const SAFETY_NET_INTERVAL_MS = 30_000
const REALTIME_DEBOUNCE_MS = 500

type PendingActivation =
  | { kind: 'scan'; qrToken: string }
  | { kind: 'manual'; physicalTableId: string; label: string }

export function SalonView({
  tenantSlug,
  tenantId,
  initialTables,
  initialOccupancy,
}: {
  tenantSlug: string
  tenantId: string
  initialTables: SalonTableRow[]
  initialOccupancy: SalonOccupancy
}) {
  const router = useRouter()
  const [tables, setTables] = useState(initialTables)
  const [occupancy, setOccupancy] = useState(initialOccupancy)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [pending, setPending] = useState<PendingActivation | null>(null)
  const [partySize, setPartySize] = useState(2)
  const [isActivating, startActivation] = useTransition()

  const freeTables = useMemo(() => tables.filter((t) => t.session === null), [tables])

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/sessions/list?tenant_id=${encodeURIComponent(tenantId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return
    const data = (await res.json()) as { tables: SalonTableRow[]; occupancy: SalonOccupancy }
    setTables(data.tables)
    setOccupancy(data.occupancy)
  }, [tenantId])

  const debouncedRefresh = useDebouncedRefresh(refresh, REALTIME_DEBOUNCE_MS)

  useEffect(() => {
    const cleanup = subscribeChanges({
      channel: `salon-${tenantId}`,
      events: [
        {
          event: '*',
          table: 'table_sessions',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: debouncedRefresh,
        },
        {
          event: '*',
          table: 'tickets',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: debouncedRefresh,
        },
        { event: 'INSERT', table: 'table_session_events', onChange: debouncedRefresh },
      ],
    })

    const safetyNet = window.setInterval(() => {
      void refresh()
    }, SAFETY_NET_INTERVAL_MS)

    return () => {
      cleanup()
      window.clearInterval(safetyNet)
    }
  }, [tenantId, refresh, debouncedRefresh])

  const onScanned = useCallback((qrToken: string) => {
    setScannerOpen(false)
    setPending({ kind: 'scan', qrToken })
    setPartySize(2)
  }, [])

  const onPickFreeTable = useCallback((physicalTableId: string, label: string) => {
    setManualOpen(false)
    setPending({ kind: 'manual', physicalTableId, label })
    setPartySize(2)
  }, [])

  const confirm = useCallback(() => {
    if (!pending) return
    startActivation(async () => {
      const result =
        pending.kind === 'scan'
          ? await activateTableByQrAction(tenantSlug, {
              qrToken: pending.qrToken,
              partySize,
              source: 'scan',
            })
          : await activateTableByIdAction(tenantSlug, {
              physicalTableId: pending.physicalTableId,
              partySize,
              source: 'manual',
            })

      if (!result.ok) {
        toast.error(result.message)
        return
      }

      if (result.wasAlreadyActive) {
        toast.info(`Mesa ${result.tableLabel ?? ''} ya estaba activa — abriendo detalle.`)
        setPending(null)
        router.push(`/${tenantSlug}/salon/mesas/${result.sessionId}`)
        return
      }

      toast.success(`Mesa ${result.tableLabel ?? ''} activada (${result.partySize} pax).`)
      setPending(null)
      await refresh()
    })
  }, [pending, partySize, tenantSlug, router, refresh])

  return (
    <div className="space-y-4">
      <OccupancyBanner occupancy={occupancy} />

      <div className="flex gap-2">
        <Button
          onClick={() => setScannerOpen(true)}
          className="flex-1 gap-2"
          size="lg"
          disabled={isActivating}
        >
          <ScanLine className="size-5" aria-hidden />
          Escanear QR
        </Button>
        <Button
          onClick={() => setManualOpen(true)}
          variant="outline"
          className="flex-1 gap-2"
          size="lg"
          disabled={isActivating || freeTables.length === 0}
        >
          <SquarePlus className="size-5" aria-hidden />
          Activar manual
        </Button>
      </div>

      <SalonTablesGrid tenantSlug={tenantSlug} tables={tables} onTapFreeTable={onPickFreeTable} />

      <QrScannerSheet open={scannerOpen} onOpenChange={setScannerOpen} onScan={onScanned} />
      <ManualActivateSheet
        open={manualOpen}
        onOpenChange={setManualOpen}
        freeTables={freeTables}
        onSelect={onPickFreeTable}
      />

      <Sheet
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) setPending(null)
        }}
      >
        <SheetContent side="bottom" className="gap-0">
          <SheetHeader>
            <SheetTitle className="font-serif">
              {pending?.kind === 'manual' ? `Mesa ${pending.label}` : 'Mesa escaneada'}
            </SheetTitle>
            <SheetDescription>¿Cuántas personas se van a sentar?</SheetDescription>
          </SheetHeader>

          <div className="px-6 py-8">
            <PartySizeStepper value={partySize} onChange={setPartySize} />
          </div>

          <SheetFooter className="flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={isActivating}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button onClick={confirm} disabled={isActivating} className="flex-1">
              {isActivating ? 'Activando…' : 'Activar mesa'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
