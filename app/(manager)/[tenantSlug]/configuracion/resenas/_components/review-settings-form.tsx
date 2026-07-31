'use client'

import { AlertTriangle, MapPin, MessageCircle } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatPhoneForDisplay } from '@/lib/phone'
import { updateReviewSettingsAction } from '@/lib/reviews/actions'
import type { ReviewSettings } from '@/lib/reviews/queries'
import { cn } from '@/lib/utils'

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
  const [rewardPoints, setRewardPoints] = useState(String(settings.reviewRewardPoints))
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    startTransition(async () => {
      const res = await updateReviewSettingsAction(tenantSlug, {
        google_maps_review_url: mapsUrl.trim() ? mapsUrl.trim() : null,
        feedback_whatsapp_phone: feedbackPhone.trim() ? feedbackPhone.trim() : null,
        review_gating_enabled: gating,
        review_reward_points: Number(rewardPoints) || 0,
      })
      if (res.ok) toast.success(res.message ?? 'Configuración guardada.')
      else toast.error(res.message)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      {/* Sin estos dos datos el flujo público no tiene adónde mandar a nadie:
          lo decimos arriba de todo para que no haya que deducirlo. */}
      {!settings.googleMapsReviewUrl || !settings.feedbackWhatsappPhone ? (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="space-y-1 text-pretty">
            <p className="font-medium">Faltan datos para que el flujo funcione.</p>
            <p className="text-muted-foreground">
              {!settings.googleMapsReviewUrl && !settings.feedbackWhatsappPhone
                ? 'Sin el enlace de Google, las reseñas de 5★ no se derivan; sin el WhatsApp, el feedback de las demás queda sólo guardado acá.'
                : !settings.googleMapsReviewUrl
                  ? 'Sin el enlace de Google, las reseñas de 5★ no se derivan a tu ficha.'
                  : 'Sin el WhatsApp, el feedback de las reseñas que no son 5★ queda sólo guardado acá.'}
            </p>
          </div>
        </div>
      ) : null}

      <div className="card-hairline space-y-5 rounded-xl border bg-card p-5">
        <div className="grid gap-1.5">
          <Label htmlFor="maps-url" className="flex items-center gap-1.5">
            <MapPin className="size-3.5 text-muted-foreground" aria-hidden="true" />
            Enlace de reseña en Google Maps
          </Label>
          <Input
            id="maps-url"
            name="google_maps_review_url"
            type="url"
            inputMode="url"
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
            placeholder="https://g.page/r/…/review"
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground text-pretty">
            Buscá tu bar en Google Maps → botón <strong>Compartir</strong> de la ficha → copiá el
            enlace y pegalo acá. Si lo dejás vacío, ninguna reseña se deriva a Maps.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="feedback-phone" className="flex items-center gap-1.5">
            <MessageCircle className="size-3.5 text-muted-foreground" aria-hidden="true" />
            WhatsApp de feedback
          </Label>
          <Input
            id="feedback-phone"
            name="feedback_whatsapp_phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={feedbackPhone}
            onChange={(e) => setFeedbackPhone(e.target.value)}
            placeholder="351 283 9101"
            maxLength={30}
            className="max-w-[18rem]"
          />
          <p className="text-xs text-muted-foreground text-pretty">
            Acá te llega el feedback de los que <strong>no</strong> puntúan 5★: se les abre WhatsApp
            con el mensaje ya escrito (nombre, puntaje y comentario). Podés escribirlo como quieras,
            lo guardamos en formato internacional. Vacío = no mostramos el botón.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border bg-background/50 p-4">
          <div className="space-y-0.5">
            <Label htmlFor="gating" className="text-sm font-medium">
              Derivar solo las de 5 estrellas
            </Label>
            <p className="text-xs text-muted-foreground text-pretty">
              Si está activo, solo las reseñas de 5★ van a Google Maps. Las demás quedan como
              feedback privado y se derivan al WhatsApp de arriba.
            </p>
          </div>
          <Switch
            id="gating"
            checked={gating}
            onCheckedChange={setGating}
            aria-describedby="gating-warning"
          />
        </div>

        {/* Advertencia de políticas de Google — el gating es desaconsejado. */}
        {gating ? (
          <div
            id="gating-warning"
            role="alert"
            className={cn(
              'flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3',
              'text-sm text-foreground',
            )}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-pretty">
              Filtrar solo 5★ a Google viola las políticas de Google y puede penalizar tu ficha. Si
              lo apagás, todas las reseñas van a Maps.
            </p>
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="reward-points">Puntos por reseña</Label>
          <Input
            id="reward-points"
            name="review_reward_points"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={rewardPoints}
            onChange={(e) => setRewardPoints(e.target.value)}
            className="max-w-[10rem]"
          />
          <p className="text-xs text-muted-foreground text-pretty">
            0 = ninguno. Se otorga una sola vez por cliente.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </form>
  )
}
