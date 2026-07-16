'use client'

import { Plus, Save } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { upsertManager } from '@/lib/salon/actions'
import type { ReservationManagerRow } from '@/lib/salon/types'

export type TeamMemberOption = {
  user_id: string
  email: string
  full_name: string | null
}

const UNLINKED = 'none'

type Draft = Partial<ReservationManagerRow> & { _isNew?: boolean }

export function ManagersList({
  tenantSlug,
  initial,
  members,
}: {
  tenantSlug: string
  initial: ReservationManagerRow[]
  members: TeamMemberOption[]
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
        user_id: null,
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
        user_id: d.user_id ?? null,
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Vinculada la cuenta del equipo, esa persona ve sus comisiones en{' '}
          <span className="font-medium text-foreground">Mis números</span>.
        </p>
        <Button onClick={addNew} className="gap-2">
          <Plus className="size-4" />
          Nuevo gestor
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card/60">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Teléfono</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Cuenta del equipo</th>
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
                <td className="px-3 py-2">
                  <Select
                    value={d.user_id ?? UNLINKED}
                    onValueChange={(v) => patch(d, 'user_id', v === UNLINKED ? null : v)}
                  >
                    <SelectTrigger className="h-9 w-44" aria-label="Cuenta del equipo">
                      <SelectValue placeholder="Sin vincular" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNLINKED}>Sin vincular</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.full_name ?? m.email}
                        </SelectItem>
                      ))}
                      {d.user_id && !members.some((m) => m.user_id === d.user_id) ? (
                        <SelectItem value={d.user_id}>Cuenta fuera del equipo</SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
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
