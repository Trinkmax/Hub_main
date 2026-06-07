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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AreaRow, LiveFloorData, LiveTable } from '@/lib/floor-plan/queries'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { activateTableByIdAction, activateTableByQrAction } from '@/lib/sessions-waiter/actions'
import type { SalonOccupancy, SalonTableRow } from '@/lib/sessions-waiter/queries'
import { filterTables } from '@/lib/sessions-waiter/table-search'
import { LiveFloor } from '../../../../../(manager)/[tenantSlug]/local/mesas/_components/live-floor'
import { ManualActivateSheet } from './manual-activate-sheet'
import { OccupancyBanner } from './occupancy-banner'
import { PartySizeStepper } from './party-size-stepper'
import { QrScannerSheet } from './qr-scanner-sheet'
import { SalonSearch } from './salon-search'
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
  liveAreas,
  initialLive,
}: {
  tenantSlug: string
  tenantId: string
  initialTables: SalonTableRow[]
  initialOccupancy: SalonOccupancy
  liveAreas: AreaRow[]
  initialLive: LiveFloorData | null
}) {
  const router = useRouter()
  const [tables, setTables] = useState(initialTables)
  const [occupancy, setOccupancy] = useState(initialOccupancy)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [pending, setPending] = useState<PendingActivation | null>(null)
  const [partySize, setPartySize] = useState(2)
  const [alias, setAlias] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isActivating, startActivation] = useTransition()

  const freeTables = useMemo(() => tables.filter((t) => t.session === null), [tables])
  const filteredTables = useMemo(() => filterTables(tables, searchQuery), [tables, searchQuery])

  // Refetch de la lista plana (pestaña Lista) — alimenta la grilla + el banner de ocupación.
  // El plano en vivo (pestaña Plano) tiene su PROPIA suscripción dentro de <LiveFloor>
  // (canal live-${tenantId}); esta es la suscripción salon-${tenantId} de la grilla.
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
    setAlias('')
  }, [])

  const onPickFreeTable = useCallback((physicalTableId: string, label: string) => {
    setManualOpen(false)
    setPending({ kind: 'manual', physicalTableId, label })
    setPartySize(2)
    setAlias('')
  }, [])

  // Tap en una mesa del plano en vivo: con sesión → su detalle; sin sesión no es
  // navegable (la activación de mesas libres vive en la pestaña Lista).
  const onLiveTableOpen = useCallback(
    (table: LiveTable) => {
      if (table.session) {
        router.push(`/${tenantSlug}/salon/mesas/${table.session.id}`)
      }
    },
    [router, tenantSlug],
  )

  const confirm = useCallback(() => {
    if (!pending) return
    startActivation(async () => {
      const trimmedAlias = alias.trim()
      const result =
        pending.kind === 'scan'
          ? await activateTableByQrAction(tenantSlug, {
              qrToken: pending.qrToken,
              partySize,
              source: 'scan',
              alias: trimmedAlias || null,
            })
          : await activateTableByIdAction(tenantSlug, {
              physicalTableId: pending.physicalTableId,
              partySize,
              source: 'manual',
              alias: trimmedAlias || null,
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

      const titulo = result.alias ?? `Mesa ${result.tableLabel ?? ''}`
      toast.success(`${titulo} activada (${result.partySize} pax).`)
      setPending(null)
      router.push(`/${tenantSlug}/salon/mesas/${result.sessionId}`)
    })
  }, [pending, partySize, alias, tenantSlug, router])

  // Sin áreas en el plano: Lista es el tab por defecto (no hay nada que mostrar en vivo).
  const defaultTab = initialLive ? 'plano' : 'lista'

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

      <Tabs defaultValue={defaultTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="plano">Plano</TabsTrigger>
          <TabsTrigger value="lista">Lista</TabsTrigger>
        </TabsList>

        <TabsContent value="plano">
          {initialLive ? (
            <LiveFloor
              slug={tenantSlug}
              tenantId={tenantId}
              areas={liveAreas}
              activeAreaId={initialLive.area.id}
              initial={initialLive}
              onTableOpen={onLiveTableOpen}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-border/60 bg-card/50 p-6 text-sm text-muted-foreground">
              Todavía no hay un plano de mesas configurado. Pedile al dueño que arme el plano en
              Local → Plano. Mientras tanto, usá la pestaña Lista.
            </p>
          )}
        </TabsContent>

        <TabsContent value="lista" className="space-y-4">
          <SalonSearch value={searchQuery} onChange={setSearchQuery} />
          <SalonTablesGrid
            tenantSlug={tenantSlug}
            tables={filteredTables}
            onTapFreeTable={onPickFreeTable}
          />
        </TabsContent>
      </Tabs>

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

          <div className="px-6 py-8 space-y-6">
            <PartySizeStepper value={partySize} onChange={setPartySize} />
            <div className="space-y-1.5">
              <label
                htmlFor="alias-input"
                className="block text-xs uppercase tracking-wider text-muted-foreground"
              >
                Alias (opcional)
              </label>
              <input
                id="alias-input"
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                maxLength={60}
                placeholder="Cumple de Juan"
                disabled={isActivating}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <p className="text-[11px] text-muted-foreground">
                Usalo para identificar el grupo (ej. para reservas que ocupan varias mesas).
              </p>
            </div>
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
