'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MenuImageUploader } from '@/components/media/image-uploader'
import { Card } from '@/components/ui/card'
import { Field, FieldRow } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SubmitButton } from '@/components/ui/submit-button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { createReward, type LoyaltyActionState } from '@/lib/points/actions'
import { REWARD_CATEGORIES } from '@/lib/points/schemas'
import type { LoyaltyTier } from '@/lib/points/tiers'
import { REWARD_CATEGORY_LABELS } from './reward-options'
import { StockField } from './stock-field'

const initial: LoyaltyActionState = { ok: true }

/** «Ninguna»: Radix Select no admite el valor vacío; el hidden manda `''`. */
const NONE = '__none__'

export function NewRewardForm({
  tenantSlug,
  tenantId,
  tiers,
}: {
  tenantSlug: string
  tenantId: string
  tiers: LoyaltyTier[]
}) {
  const action = createReward.bind(null, tenantSlug)
  // Ordenamos los niveles por umbral de puntos de categoría para que el selector sea intuitivo.
  const sortedTiers = tiers
    .slice()
    .sort((a, b) => a.min_category_points - b.min_category_points || a.sort - b.sort)
  const [state, formAction] = useActionState(action, initial)
  const formRef = useRef<HTMLFormElement>(null)
  // La visibilidad viaja por un input hidden controlado ('true' | 'false').
  const [visible, setVisible] = useState(true)
  // La foto viaja por un input hidden; la URL la resuelve el uploader (Storage).
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [category, setCategory] = useState(NONE)
  const [minTierId, setMinTierId] = useState(NONE)
  // Stock: arranca ilimitado, que es lo que quiere el 90% de las recompensas de
  // un bar. Con el switch prendido no se manda `stock` y el schema lo deja null.
  const [unlimitedStock, setUnlimitedStock] = useState(true)
  const [stock, setStock] = useState<number | null>(null)

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setVisible(true)
      setImageUrl(null)
      setCategory(NONE)
      setMinTierId(NONE)
      setUnlimitedStock(true)
      setStock(null)
    } else if (!state.ok) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <Card asChild>
      <form ref={formRef} action={formAction} aria-labelledby="new-reward-title">
        <h3 id="new-reward-title" className="type-subtitle text-foreground">
          Nueva recompensa
        </h3>

        <Field label="Nombre" name="name" required>
          <Input maxLength={80} placeholder="Trago gratis" />
        </Field>
        <Field label="Descripción" name="description" optional>
          <Textarea
            maxLength={300}
            showCount
            rows={2}
            placeholder="Lo que ve el cajero al canjear: qué incluye, con qué se puede elegir…"
          />
        </Field>

        {/* Foto que ve el cliente en el catálogo de canje de la carta. */}
        <input type="hidden" name="image_url" value={imageUrl ?? ''} />
        <MenuImageUploader
          tenantId={tenantId}
          value={imageUrl}
          onChange={setImageUrl}
          label="Foto de la recompensa"
        />

        <input type="hidden" name="category" value={category === NONE ? '' : category} />
        <input type="hidden" name="min_tier_id" value={minTierId === NONE ? '' : minTierId} />
        <FieldRow>
          <Field label="Categoría" optional>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin categoría</SelectItem>
                {REWARD_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {REWARD_CATEGORY_LABELS[cat] ?? cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {sortedTiers.length > 0 ? (
            <Field
              label="Disponibilidad por nivel"
              hint="Con un nivel elegido, solo la canjean los clientes que lo alcanzaron."
            >
              <Select value={minTierId} onValueChange={setMinTierId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Disponible para todos</SelectItem>
                  {sortedTiers.map((tier) => (
                    <SelectItem key={tier.id} value={tier.id}>
                      Desde {tier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </FieldRow>

        <Field
          label="Mostrar en el catálogo de canje"
          layout="toggle"
          hint="Si la ocultás, sigue vigente pero no aparece en la carta pública."
        >
          <Switch checked={visible} onCheckedChange={setVisible} />
        </Field>
        <input type="hidden" name="visible_in_catalog" value={visible ? 'true' : 'false'} />

        <FieldRow>
          <Field label="Costo" name="cost_points" required>
            <NumberField min={1} step={10} suffix="pts" placeholder="100" />
          </Field>
          <StockField
            idPrefix="rw"
            unlimited={unlimitedStock}
            onUnlimitedChange={setUnlimitedStock}
            value={stock}
            onValueChange={setStock}
          />
        </FieldRow>

        <FormActions sticky={false}>
          <SubmitButton pendingText="Creando…">
            <Plus aria-hidden="true" />
            Crear recompensa
          </SubmitButton>
        </FormActions>
      </form>
    </Card>
  )
}
