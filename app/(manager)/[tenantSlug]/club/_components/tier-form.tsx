'use client'

import { type ReactNode, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldRow } from '@/components/ui/field'
import { IconPicker } from '@/components/ui/icon-picker'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { createTier, type LoyaltyActionState, updateTier } from '@/lib/points/actions'
import type { LoyaltyTier } from '@/lib/points/tiers'

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
  const [badgeIcon, setBadgeIcon] = useState<string | null>(defaults?.badge_icon ?? null)
  const [nameError, setNameError] = useState<string | null>(null)

  // Reset a los valores de partida cada vez que se abre (importante al reusar
  // el mismo form para distintas filas en una lista).
  useEffect(() => {
    if (isOpen) {
      setColor(defaults?.color ?? DEFAULT_COLOR)
      setActive(tier?.active ?? true)
      setBadgeIcon(defaults?.badge_icon ?? null)
      setNameError(null)
    }
  }, [isOpen, tier, defaults])

  // onSubmit y no `action`: la acción corre en el cliente y, si el server
  // rechaza, lo tipeado queda (un `<form action>` resetea los campos al volver).
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const name = String(formData.get('name') ?? '').trim()
    if (!name) {
      setNameError('Poné un nombre para el nivel.')
      return
    }
    setNameError(null)

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
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar nivel' : 'Nuevo nivel'}</DialogTitle>
          <DialogDescription>
            El nivel se alcanza juntando puntos de categoría (los ganados en los últimos 4 meses).
            Acá va su umbral y cómo se ve; los beneficios se cargan aparte.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="grid gap-4">
            <Field label="Nombre" name="name" required error={nameError}>
              <Input
                autoFocus
                maxLength={40}
                defaultValue={defaults?.name ?? ''}
                placeholder="Oro"
              />
            </Field>

            <FieldRow>
              <Field label="Color" optional hint="Formato #RRGGBB. Vacío usa el color por defecto.">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_COLOR}
                    onChange={(e) => setColor(e.target.value)}
                    aria-label="Elegir el color en la paleta"
                    className="size-(--control-md) shrink-0 cursor-pointer rounded-md border border-input bg-card p-0.5 outline-offset-2 outline-(--ring) focus-visible:outline-2"
                  />
                  <Input
                    name="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder="#8a6d3b"
                    maxLength={7}
                    className="font-mono type-amount"
                  />
                </div>
              </Field>

              <Field
                label="Ícono del nivel"
                optional
                hint="Acompaña al nombre del nivel en el carnet del socio."
              >
                <IconPicker value={badgeIcon} onChange={setBadgeIcon} name="badge_icon" />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field
                label="Puntos de categoría para alcanzarlo"
                name="min_category_points"
                required
                hint="Puntos ganados en los últimos 4 meses. El nivel sube y baja con la actividad."
              >
                <NumberField
                  min={0}
                  step={50}
                  largeStep={500}
                  suffix="pts"
                  defaultValue={defaults?.min_category_points ?? 0}
                />
              </Field>

              <Field label="Orden" name="sort" hint="Desempata niveles con el mismo umbral.">
                <NumberField min={0} defaultValue={defaults?.sort ?? 0} />
              </Field>
            </FieldRow>

            <Field
              label="Nota visible al cliente"
              name="perks"
              optional
              hint="Texto libre que describe las ventajas. Lo ve el cliente."
            >
              <Textarea
                maxLength={300}
                showCount
                rows={2}
                defaultValue={defaults?.perks ?? ''}
                placeholder="Ej: 10% off siempre, acceso a la barra VIP…"
              />
            </Field>

            <Field
              label="Nivel activo"
              layout="toggle"
              hint="Los niveles inactivos no se asignan ni se muestran."
            >
              <Switch checked={active} onCheckedChange={setActive} />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} loadingText="Guardando…">
              {isEdit ? 'Guardar cambios' : 'Crear nivel'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
