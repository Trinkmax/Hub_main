'use client'

import { Plus, Save } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { upsertManager } from '@/lib/salon/actions'
import type { ReservationManagerRow } from '@/lib/salon/types'

type Draft = Partial<ReservationManagerRow> & { _isNew?: boolean }

export function ManagersList({
  tenantSlug,
  initial,
}: {
  tenantSlug: string
  initial: ReservationManagerRow[]
}) {
  const [drafts, setDrafts] = useState<Draft[]>(initial)
  const [pending, startTransition] = useTransition()

  function addNew() {
    setDrafts((prev) => [
      {
        _isNew: true,
        display_name: '',
        commission_eligible: false,
        active: true,
      } as Draft,
      ...prev,
    ])
  }

  function patch(d: Draft, key: keyof Draft, value: unknown) {
    setDrafts((prev) => prev.map((x) => (x === d ? { ...x, [key]: value } : x)))
  }

  function save(d: Draft) {
    if (!d.display_name) {
      toast.error('Nombre requerido.')
      return
    }
    startTransition(async () => {
      const r = await upsertManager(tenantSlug, {
        ...(d.id && !d._isNew ? { id: d.id } : {}),
        display_name: d.display_name,
        phone: d.phone ?? null,
        email: d.email ?? null,
        commission_eligible: d.commission_eligible ?? false,
        active: d.active ?? true,
        notes: d.notes ?? null,
      } as Record<string, unknown>)
      if (r.ok) {
        toast.success('Gestor guardado.')
        if (d._isNew && r.data?.id) {
          setDrafts((prev) =>
            prev.map((x) => (x === d ? { ...x, id: r.data?.id as string, _isNew: false } : x)),
          )
        }
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={addNew} className="gap-2">
          <Plus className="size-4" />
          Nuevo gestor
        </Button>
      </div>
      <div className="rounded-xl border bg-card/60">
        <table className="w-full text-sm">
          <thead className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Teléfono</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2 text-center">Comisión</th>
              <th className="px-3 py-2 text-center">Activo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {drafts.map((d, idx) => (
              <tr key={d.id ?? `new-${idx}`}>
                <td className="px-3 py-2">
                  <Input
                    value={d.display_name ?? ''}
                    onChange={(e) => patch(d, 'display_name', e.target.value)}
                    placeholder="Luz"
                    maxLength={80}
                    className="h-9"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={d.phone ?? ''}
                    onChange={(e) => patch(d, 'phone', e.target.value)}
                    placeholder="+54 9 351…"
                    className="h-9"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="email"
                    value={d.email ?? ''}
                    onChange={(e) => patch(d, 'email', e.target.value)}
                    placeholder="luz@hub.com"
                    className="h-9"
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <Switch
                    checked={d.commission_eligible ?? false}
                    onCheckedChange={(v) => patch(d, 'commission_eligible', v)}
                    aria-label="Cobra comisión"
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <Switch
                    checked={d.active ?? true}
                    onCheckedChange={(v) => patch(d, 'active', v)}
                    aria-label="Activo"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => save(d)}
                    disabled={pending}
                    aria-label="Guardar"
                  >
                    <Save className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
