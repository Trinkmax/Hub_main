'use client'

import { Plus, Save, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  removeZoneOverride,
  setZoneCapacityDefaults,
  upsertZoneOverride,
} from '@/lib/salon/actions'
import { type SalonZoneCapacityOverrideRow, ZONE_LABELS } from '@/lib/salon/types'

export function ZoneCapacityEditor({
  tenantSlug,
  defaults,
  initialOverrides,
}: {
  tenantSlug: string
  defaults: { planta_alta: number; planta_baja: number }
  initialOverrides: SalonZoneCapacityOverrideRow[]
}) {
  const [pa, setPA] = useState(defaults.planta_alta)
  const [pb, setPB] = useState(defaults.planta_baja)
  const [overrides, setOverrides] = useState(initialOverrides)
  const [pending, startTransition] = useTransition()
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  // Nuevo override
  const [newZone, setNewZone] = useState<'planta_alta' | 'planta_baja'>('planta_alta')
  const [newDate, setNewDate] = useState('')
  const [newCap, setNewCap] = useState(0)
  const [newReason, setNewReason] = useState('')

  function saveDefaults() {
    startTransition(async () => {
      const r = await setZoneCapacityDefaults(tenantSlug, {
        planta_alta: pa,
        planta_baja: pb,
      } as Record<string, unknown>)
      if (r.ok) toast.success('Capacidad default guardada.')
      else toast.error(r.message)
    })
  }

  function addOverride() {
    if (!newDate) {
      toast.error('Fecha requerida.')
      return
    }
    startTransition(async () => {
      const r = await upsertZoneOverride(tenantSlug, {
        zone: newZone,
        override_date: newDate,
        capacity: newCap,
        reason: newReason || undefined,
      } as Record<string, unknown>)
      if (r.ok) {
        toast.success('Override guardado.')
        // Refresh local: insertamos o actualizamos
        const existing = overrides.find((o) => o.zone === newZone && o.override_date === newDate)
        if (existing) {
          setOverrides((prev) =>
            prev.map((o) =>
              o.id === existing.id ? { ...o, capacity: newCap, reason: newReason || null } : o,
            ),
          )
        } else {
          setOverrides((prev) =>
            [
              {
                id: crypto.randomUUID(),
                tenant_id: '',
                zone: newZone,
                override_date: newDate,
                capacity: newCap,
                reason: newReason || null,
                created_at: new Date().toISOString(),
              } as SalonZoneCapacityOverrideRow,
              ...prev,
            ].sort((a, b) => (a.override_date < b.override_date ? 1 : -1)),
          )
        }
        setNewDate('')
        setNewCap(0)
        setNewReason('')
      } else {
        toast.error(r.message)
      }
    })
  }

  function confirmDeleteOverride() {
    if (!pendingDelete) return
    const id = pendingDelete
    startTransition(async () => {
      const r = await removeZoneOverride(tenantSlug, id)
      if (r.ok) {
        setOverrides((prev) => prev.filter((o) => o.id !== id))
        toast.success('Override eliminado.')
      } else {
        toast.error(r.message)
      }
      setPendingDelete(null)
    })
  }

  return (
    <>
      {/* Defaults */}
      <section className="space-y-4 rounded-xl border bg-card/60 p-5">
        <h2 className="font-serif text-base font-semibold">Capacidad default por zona</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-[11px] uppercase tracking-wide">{ZONE_LABELS.planta_alta}</Label>
            <Input
              type="number"
              min={0}
              max={999}
              value={pa}
              onChange={(e) => setPA(Math.max(0, Number(e.target.value)))}
              className="h-10 text-base tabular-nums"
            />
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wide">{ZONE_LABELS.planta_baja}</Label>
            <Input
              type="number"
              min={0}
              max={999}
              value={pb}
              onChange={(e) => setPB(Math.max(0, Number(e.target.value)))}
              className="h-10 text-base tabular-nums"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={saveDefaults} disabled={pending} className="gap-2">
            <Save className="size-4" />
            Guardar defaults
          </Button>
        </div>
      </section>

      {/* Overrides */}
      <section className="space-y-3 rounded-xl border bg-card/60 p-5">
        <h2 className="font-serif text-base font-semibold">Overrides por fecha</h2>
        <p className="text-xs text-muted-foreground">
          Para días puntuales (reforma, evento privado, etc.) podés sobreescribir el cupo.
        </p>

        <div className="grid gap-2 rounded-lg border border-dashed p-3 sm:grid-cols-[1fr_1fr_120px_1fr_auto]">
          <Select
            value={newZone}
            onValueChange={(v) => setNewZone(v as 'planta_alta' | 'planta_baja')}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="planta_alta">{ZONE_LABELS.planta_alta}</SelectItem>
              <SelectItem value="planta_baja">{ZONE_LABELS.planta_baja}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="h-9"
          />
          <Input
            type="number"
            min={0}
            placeholder="Cap"
            value={newCap || ''}
            onChange={(e) => setNewCap(Number(e.target.value))}
            className="h-9 tabular-nums"
          />
          <Input
            placeholder="Motivo (opcional)"
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            className="h-9"
            maxLength={280}
          />
          <Button size="sm" onClick={addOverride} disabled={pending} className="gap-1.5">
            <Plus className="size-4" />
            Agregar
          </Button>
        </div>

        {overrides.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin overrides cargados.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {overrides.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="rounded-md bg-secondary px-2 py-0.5 text-xs">
                    {ZONE_LABELS[o.zone as 'planta_alta' | 'planta_baja']}
                  </span>
                  <span className="font-mono tabular-nums">{o.override_date}</span>
                  <span className="font-mono tabular-nums font-semibold">cap {o.capacity}</span>
                  {o.reason ? (
                    <span className="text-xs text-muted-foreground">· {o.reason}</span>
                  ) : null}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setPendingDelete(o.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar este override?</AlertDialogTitle>
            <AlertDialogDescription>
              La zona volverá a usar su capacidad default para esa fecha. Esta acción no se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={pending}
              onClick={confirmDeleteOverride}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
