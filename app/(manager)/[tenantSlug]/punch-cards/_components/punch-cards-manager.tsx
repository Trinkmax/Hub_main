'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useActionState, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  createPunchCard,
  deletePunchCard,
  type PunchCardActionState,
} from '@/lib/punch-cards/actions'
import type { PunchCardTemplateRow } from '@/lib/punch-cards/queries'

const initial: PunchCardActionState = { ok: false, message: '' }

export function PunchCardsManager({
  tenantSlug,
  initialTemplates,
  items,
  categories,
  tags,
  rewards,
}: {
  tenantSlug: string
  initialTemplates: PunchCardTemplateRow[]
  items: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string }>
  tags: Array<{ id: string; name: string }>
  rewards: Array<{ id: string; name: string }>
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [triggerType, setTriggerType] = useState<'item' | 'category' | 'tag'>('category')
  const [pending, startTransition] = useTransition()
  const [state, action, formPending] = useActionState(
    (prev: PunchCardActionState, fd: FormData) => createPunchCard(tenantSlug, prev, fd),
    initial,
  )

  useEffect(() => {
    if (state.ok) setShowCreate(false)
  }, [state.ok])

  const triggerOptions =
    triggerType === 'item' ? items : triggerType === 'category' ? categories : tags

  const handleDelete = (id: string, name: string) => {
    startTransition(async () => {
      const r = await deletePunchCard(tenantSlug, id)
      if (r.ok) toast.success(`Card "${name}" eliminada`)
      else toast.error(r.message)
    })
  }

  if (rewards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Necesitás al menos un <strong>reward</strong> para crear punch cards. Andá a /puntos
          primero.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Tus punch cards</h2>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1.5 size-4" />
              Nueva punch card
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nueva punch card</DialogTitle>
            </DialogHeader>
            <form action={action} className="space-y-3">
              <div>
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  name="name"
                  autoFocus
                  required
                  maxLength={80}
                  placeholder="5 cafés = 1 café gratis"
                />
              </div>
              <div>
                <Label htmlFor="description">Descripción (opcional)</Label>
                <Textarea id="description" name="description" maxLength={400} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="trigger_type">Avanza con</Label>
                  <Select
                    name="trigger_type"
                    defaultValue="category"
                    onValueChange={(v) => setTriggerType(v as typeof triggerType)}
                  >
                    <SelectTrigger id="trigger_type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="item">Ítem específico</SelectItem>
                      <SelectItem value="category">Categoría</SelectItem>
                      <SelectItem value="tag">Tag</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="trigger_ref_id">Cuál</Label>
                  <Select name="trigger_ref_id" required>
                    <SelectTrigger id="trigger_ref_id">
                      <SelectValue placeholder="Seleccionar…" />
                    </SelectTrigger>
                    <SelectContent>
                      {triggerOptions.map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>
                          {opt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="threshold">Cantidad para completar</Label>
                  <Input
                    id="threshold"
                    name="threshold"
                    type="number"
                    min={2}
                    max={100}
                    required
                    defaultValue={5}
                  />
                </div>
                <div>
                  <Label htmlFor="expires_after_days">Vence en días (opcional)</Label>
                  <Input
                    id="expires_after_days"
                    name="expires_after_days"
                    type="number"
                    min={1}
                    max={365}
                    placeholder="ej: 90"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="reward_id">Reward al completar</Label>
                <Select name="reward_id" required>
                  <SelectTrigger id="reward_id">
                    <SelectValue placeholder="Seleccionar reward…" />
                  </SelectTrigger>
                  <SelectContent>
                    {rewards.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!state.ok && state.message && (
                <p className="text-sm text-destructive">{state.message}</p>
              )}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={formPending}>
                  {formPending ? 'Creando…' : 'Crear card'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {initialTemplates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No hay punch cards todavía. Creá la primera para que tus clientes empiecen a sumar
            stamps.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {initialTemplates.map((t) => (
            <div key={t.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">{t.name}</h3>
                  {t.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                  )}
                </div>
                {!t.active && <Badge variant="secondary">Inactiva</Badge>}
              </div>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <p>
                  Cada {t.threshold} de tipo <strong>{t.trigger_type}</strong> →{' '}
                  {t.reward_name ?? '?'}
                </p>
                {t.expires_after_days && (
                  <p>Vence en {t.expires_after_days} días desde el primer stamp.</p>
                )}
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => handleDelete(t.id, t.name)}
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
