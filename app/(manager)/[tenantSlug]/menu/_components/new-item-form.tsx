'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MenuImageUploader } from '@/components/media/image-uploader'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MoneyField } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
import { SubmitButton } from '@/components/ui/submit-button'
import { createMenuItem, type MenuActionState } from '@/lib/menu/actions'
import { MenuVideoUploader } from './video-uploader'

const initial: MenuActionState = { ok: true }

/** La carta muestra precios sin centavos: se cargan en pesos enteros. */
export const WHOLE_PESOS_MESSAGE = 'Escribí el precio en pesos, sin centavos.'

export function NewItemForm({
  tenantSlug,
  tenantId,
  categoryId,
  onCreated,
}: {
  tenantSlug: string
  tenantId: string
  categoryId: string
  // Callback opcional para que el contenedor (p. ej. un Popover) se cierre tras
  // crear el ítem con éxito. Si no se pasa, el form sólo se resetea.
  onCreated?: () => void
}) {
  const action = createMenuItem.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const formRef = useRef<HTMLFormElement>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  // El precio se ve en pesos y viaja en centavos (`price_cents`, hidden del MoneyField).
  const [priceCents, setPriceCents] = useState<number | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setImageUrl(null)
      setVideoUrl(null)
      setPriceError(null)
      onCreated?.()
    } else if (!state.ok) {
      toast.error(state.message)
    }
  }, [state, onCreated])

  return (
    <form
      ref={formRef}
      action={formAction}
      // Antes de mandar: el precio va en pesos enteros, como lo muestra la carta.
      onSubmit={(event) => {
        if (priceCents !== null && priceCents % 100 !== 0) {
          event.preventDefault()
          setPriceError(WHOLE_PESOS_MESSAGE)
        }
      }}
      className="grid gap-4"
    >
      <input type="hidden" name="category_id" value={categoryId} />
      <input type="hidden" name="image_url" value={imageUrl ?? ''} />
      <input type="hidden" name="video_url" value={videoUrl ?? ''} />

      <Field label="Nombre" name="name" required>
        <Input maxLength={80} placeholder="Fernet con cola" autoComplete="off" />
      </Field>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label="Precio" name="price_cents" required error={priceError}>
          <MoneyField
            decimals="auto"
            placeholder="15.500"
            onCentsChange={(cents) => {
              setPriceCents(cents)
              if (priceError) setPriceError(null)
            }}
          />
        </Field>
        <Field
          label="Puntos extra"
          name="points_override"
          optional
          hint="Se suman cuando alguien pide este ítem."
        >
          <NumberField min={0} steppers={false} placeholder="—" />
        </Field>
      </div>

      <MenuImageUploader tenantId={tenantId} value={imageUrl} onChange={setImageUrl} />

      <MenuVideoUploader tenantId={tenantId} value={videoUrl} onChange={setVideoUrl} />

      <div className="flex justify-end">
        <SubmitButton pendingText="Agregando…">
          <Plus aria-hidden="true" />
          Agregar ítem
        </SubmitButton>
      </div>
    </form>
  )
}
