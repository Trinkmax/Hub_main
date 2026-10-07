'use client'

import { MapPin, MessageCircle } from 'lucide-react'
import { type FormEvent, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import { Switch } from '@/components/ui/switch'
import { formatPhoneForDisplay } from '@/lib/phone'
import { updateReviewSettingsAction } from '@/lib/reviews/actions'
import type { ReviewSettings } from '@/lib/reviews/queries'

export function ReviewSettingsForm({
  tenantSlug,
  settings,
}: {
  tenantSlug: string
  settings: ReviewSettings
}): React.JSX.Element {
  const [mapsUrl, setMapsUrl] = useState(settings.googleMapsReviewUrl ?? '')
  // Se guarda en E.164 pero se muestra legible: nadie reconoce +5493512839101.
  const [feedbackPhone, setFeedbackPhone] = useState(
    settings.feedbackWhatsappPhone ? formatPhoneForDisplay(settings.feedbackWhatsappPhone) : '',
  )
  const [gating, setGating] = useState(settings.reviewGatingEnabled)
  const [rewardPoints, setRewardPoints] = useState<number | null>(settings.reviewRewardPoints)
  const [pending, startTransition] = useTransition()

  // Un número de puntos que no se entiende frena el envío antes de llegar acá
  // (el campo muestra por qué); vacío cuenta como 0, igual que antes.
  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    startTransition(async () => {
      const res = await updateReviewSettingsAction(tenantSlug, {
        google_maps_review_url: mapsUrl.trim() ? mapsUrl.trim() : null,
        feedback_whatsapp_phone: feedbackPhone.trim() ? feedbackPhone.trim() : null,
        review_gating_enabled: gating,
        review_reward_points: rewardPoints ?? 0,
      })
      if (res.ok) toast.success(res.message ?? 'Configuración guardada.')
      else toast.error(res.message)
    })
  }

  const missingMaps = !settings.googleMapsReviewUrl
  const missingPhone = !settings.feedbackWhatsappPhone

  return (
    <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-6">
      {/* Sin estos dos datos el flujo público no tiene adónde mandar a nadie:
          lo decimos arriba de todo para que no haya que deducirlo. */}
      {missingMaps || missingPhone ? (
        <Callout tone="warning" title="Faltan datos para que el flujo funcione">
          {missingMaps && missingPhone
            ? 'Sin el enlace de Google, las reseñas de 5★ no se derivan; sin el WhatsApp, el feedback de las demás queda solo guardado acá.'
            : missingMaps
              ? 'Sin el enlace de Google, las reseñas de 5★ no se derivan a tu ficha.'
              : 'Sin el WhatsApp, el feedback de las reseñas que no son 5★ queda solo guardado acá.'}
        </Callout>
      ) : null}

      <Card>
        <Field
          label="Enlace de reseña en Google Maps"
          name="google_maps_review_url"
          hint={
            <>
              Buscá tu bar en Google Maps → botón <strong>Compartir</strong> de la ficha → copiá el
              enlace y pegalo acá. Si lo dejás vacío, ninguna reseña se deriva a Maps.
            </>
          }
        >
          <InputGroup>
            <InputAddon>
              <MapPin aria-hidden />
            </InputAddon>
            <Input
              type="url"
              inputMode="url"
              value={mapsUrl}
              onChange={(e) => setMapsUrl(e.target.value)}
              placeholder="https://g.page/r/…/review"
              maxLength={500}
              autoComplete="off"
              spellCheck={false}
            />
          </InputGroup>
        </Field>

        <Field
          label="WhatsApp de feedback"
          name="feedback_whatsapp_phone"
          hint={
            <>
              Acá te llega el feedback de los que <strong>no</strong> puntúan 5★: se les abre
              WhatsApp con el mensaje ya escrito (nombre, puntaje y comentario). Escribilo como
              quieras: lo guardamos en formato internacional. Vacío = no mostramos el botón.
            </>
          }
        >
          <InputGroup className="sm:max-w-72">
            <InputAddon>
              <MessageCircle aria-hidden />
            </InputAddon>
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={feedbackPhone}
              onChange={(e) => setFeedbackPhone(e.target.value)}
              placeholder="351 283 9101"
              maxLength={30}
            />
          </InputGroup>
        </Field>

        <div className="flex flex-col gap-3 border-y border-border py-3">
          <Field
            layout="toggle"
            label="Derivar solo las de 5 estrellas"
            hint="Si está activo, solo las reseñas de 5★ van a Google Maps. Las demás quedan como feedback privado y se derivan al WhatsApp de arriba."
          >
            <Switch
              checked={gating}
              onCheckedChange={setGating}
              aria-describedby={gating ? 'gating-warning' : undefined}
            />
          </Field>

          {/* Advertencia de políticas de Google — el gating es desaconsejado. */}
          {gating ? (
            <Callout id="gating-warning" tone="warning" announce="polite">
              Filtrar solo 5★ a Google viola las políticas de Google y puede penalizar tu ficha. Si
              lo apagás, todas las reseñas van a Maps.
            </Callout>
          ) : null}
        </div>

        <Field
          label="Puntos por reseña"
          name="review_reward_points"
          hint="0 = ninguno. Se dan una sola vez por cliente."
          className="sm:max-w-56"
        >
          <NumberField
            value={rewardPoints}
            onValueChange={setRewardPoints}
            min={0}
            max={1_000_000}
            suffix="puntos"
          />
        </Field>
      </Card>

      <FormActions>
        <Button type="submit" loading={pending} loadingText="Guardando…">
          Guardar
        </Button>
      </FormActions>
    </form>
  )
}
