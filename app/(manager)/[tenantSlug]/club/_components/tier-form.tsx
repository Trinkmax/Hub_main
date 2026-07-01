'use client'

import { Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { createTier, type LoyaltyActionState, updateTier } from '@/lib/points/actions'
import type { LoyaltyTier } from '@/lib/points/tiers'
import { cn } from '@/lib/utils'

const DEFAULT_COLOR = '#8a6d3b'

// Forma del objeto que mandamos a createTier/updateTier.
// Espejo de createTierSchema (sin id) + `id` opcional para update.
type TierInput = {
  id?: string
  name: string
  color: string | null
  badge_icon: string | null
  min_category_points: number
  sort: number
  perks: string | null
  active: boolean
}

/** Valores para pre-rellenar un nivel NUEVO (sin id) — ej. el arranque rápido. */
export type TierSeed = Pick<
  LoyaltyTier,
  'name' | 'color' | 'min_category_points' | 'sort' | 'badge_icon' | 'perks'
>

export function TierForm({
  tenantSlug,
  tier,
  seed,
  trigger,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  /** Si viene, el form EDITA ese nivel existente (llama a updateTier). */
  tier?: LoyaltyTier
  /** Pre-rellena un nivel NUEVO en modo creación (llama a createTier). Ignorado si viene `tier`. */
  seed?: TierSeed
  /** Disparador opcional (botón). Si se controla externamente con open/onOpenChange, omitilo. */
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isEdit = Boolean(tier)
  // Valores de partida: el nivel a editar, o el seed de creación, o vacíos.
  const defaults = tier ?? seed ?? null
  const [internalOpen, setInternalOpen] = useState(false)
  const controlled = open !== undefined
  const isOpen = controlled ? open : internalOpen
  const setOpen = controlled ? (onOpenChange ?? (() => {})) : setInternalOpen

  const [pending, startTransition] = useTransition()

  // Estado controlado de los campos que necesitan reactividad (color preview, switch).
  const [color, setColor] = useState<string>(defaults?.color ?? DEFAULT_COLOR)
  const [active, setActive] = useState<boolean>(tier?.active ?? true)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Reset a los valores de partida cada vez que se abre (importante al reusar
  // el mismo form para distintas filas en una lista).
  useEffect(() => {
    if (isOpen) {
      setColor(defaults?.color ?? DEFAULT_COLOR)
      setActive(tier?.active ?? true)
      setFieldErrors({})
    }
  }, [isOpen, tier, defaults])

  const handleSubmit = (formData: FormData) => {
    const name = String(formData.get('name') ?? '').trim()
    if (!name) {
      setFieldErrors({ name: 'Poné un nombre.' })
      return
    }
    setFieldErrors({})

    const hexInput = String(formData.get('color') ?? '').trim()
    const badgeInput = String(formData.get('badge_icon') ?? '').trim()
    const perksInput = String(formData.get('perks') ?? '').trim()

    const input: TierInput = {
      ...(tier ? { id: tier.id } : {}),
      name,
      color: hexInput.length > 0 ? hexInput : null,
      badge_icon: badgeInput.length > 0 ? badgeInput : null,
      min_category_points: Number(formData.get('min_category_points') ?? 0),
      sort: Number(formData.get('sort') ?? 0),
      perks: perksInput.length > 0 ? perksInput : null,
      active,
    }

    startTransition(async () => {
      const result: LoyaltyActionState = isEdit
        ? await updateTier(tenantSlug, input)
        : await createTier(tenantSlug, input)

      if (result.ok) {
        toast.success(result.message ?? (isEdit ? 'Nivel actualizado.' : 'Nivel creado.'))
        setOpen(false)
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger}
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {isEdit ? 'Editar nivel' : 'Nuevo nivel'}
          </DialogTitle>
          <DialogDescription>
            El nivel se alcanza acumulando puntos de categoría (los ganados en los últimos 4 meses).
            Definí su umbral y estética; los beneficios se cargan aparte.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-4">
          {/* Nombre */}
          <div className="grid gap-1.5">
            <Label htmlFor="tier-name">Nombre</Label>
            <Input
              id="tier-name"
              name="name"
              autoFocus
              required
              maxLength={40}
              defaultValue={defaults?.name ?? ''}
              placeholder="Oro"
              aria-invalid={fieldErrors.name ? true : undefined}
            />
            {fieldErrors.name ? (
              <p className="text-xs text-destructive">{fieldErrors.name}</p>
            ) : null}
          </div>

          {/* Color + ícono */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tier-color">Color (opcional)</Label>
              <div className="flex items-center gap-2">
                <input
                  id="tier-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label="Elegir color del nivel"
                  className="size-9 shrink-0 cursor-pointer rounded-md border border-border/70 bg-transparent p-0.5"
                />
                <Input
                  name="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#8a6d3b"
                  maxLength={7}
                  className="font-mono text-xs tabular-nums"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Formato hex #RRGGBB. Dejalo vacío para usar el color por defecto.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="tier-badge">Ícono (opcional)</Label>
              <Input
                id="tier-badge"
                name="badge_icon"
                maxLength={40}
                defaultValue={defaults?.badge_icon ?? ''}
                placeholder="Crown"
              />
              <p className="text-[11px] text-muted-foreground">
                Nombre de un ícono de Lucide (ej: Crown, Star, Gem).
              </p>
            </div>
          </div>

          {/* Umbral + orden */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tier-min">Puntos de categoría para alcanzarlo</Label>
              <Input
                id="tier-min"
                name="min_category_points"
                type="number"
                min={0}
                required
                defaultValue={defaults?.min_category_points ?? 0}
                className="tabular-nums"
              />
              <p className="text-[11px] text-muted-foreground">
                Puntos ganados en los últimos 4 meses. El nivel sube y baja con la actividad.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="tier-sort">Orden</Label>
              <Input
                id="tier-sort"
                name="sort"
                type="number"
                defaultValue={defaults?.sort ?? 0}
                className="tabular-nums"
              />
              <p className="text-[11px] text-muted-foreground">
                Desempata niveles con el mismo umbral.
              </p>
            </div>
          </div>

          {/* Perks */}
          <div className="grid gap-1.5">
            <Label htmlFor="tier-perks">Nota visible al cliente (opcional)</Label>
            <Textarea
              id="tier-perks"
              name="perks"
              maxLength={300}
              rows={2}
              defaultValue={defaults?.perks ?? ''}
              className="resize-none"
              placeholder="Ej: 10% off siempre, acceso a la barra VIP…"
            />
            <p className="text-[11px] text-muted-foreground">
              Texto libre que describe las ventajas. Se muestra al cliente.
            </p>
          </div>

          {/* Activo */}
          <div
            className={cn(
              'flex items-center justify-between rounded-lg border border-border/70 bg-card/60 px-3 py-2.5',
            )}
          >
            <div className="space-y-0.5">
              <Label htmlFor="tier-active" className="text-sm font-medium">
                Nivel activo
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Los niveles inactivos no se asignan ni se muestran.
              </p>
            </div>
            <Switch
              id="tier-active"
              checked={active}
              onCheckedChange={setActive}
              aria-label="Nivel activo"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="min-w-[140px]">
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Guardando…
                </>
              ) : isEdit ? (
                'Guardar cambios'
              ) : (
                'Crear nivel'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
