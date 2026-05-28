'use client'

import { AlertTriangle, ArrowRight, Check, Gift, Sparkles } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { Reward } from '@/lib/points/queries'
import { cn } from '@/lib/utils'
import {
  updateWelcomeRewardConfig,
  type WelcomeRewardActionState,
} from '@/lib/welcome-reward/actions'
import type { WelcomeRewardConfigWithReward } from '@/lib/welcome-reward/queries'

const HEADLINE_MAX = 80
const SUBTEXT_MAX = 160
const LOW_STOCK_THRESHOLD = 5

const initialState: WelcomeRewardActionState = { ok: true }

// Submit con spinner que reacciona a useFormStatus.
// Separado del form root para que useFormStatus capture el estado del <form>.
function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="min-w-[180px]">
      {pending ? 'Guardando…' : 'Guardar configuración'}
    </Button>
  )
}

export function WelcomeRewardForm({
  tenantSlug,
  initialConfig,
  availableRewards,
}: {
  tenantSlug: string
  initialConfig: WelcomeRewardConfigWithReward
  availableRewards: Reward[]
}) {
  // Estados locales — el form es controlado para que el preview reaccione live.
  const [enabled, setEnabled] = useState(initialConfig.enabled)
  const [rewardId, setRewardId] = useState<string | null>(initialConfig.reward_id)
  const [headline, setHeadline] = useState(initialConfig.headline)
  const [subtext, setSubtext] = useState(initialConfig.subtext)

  const [state, formAction] = useActionState<WelcomeRewardActionState, FormData>(
    (prev, fd) => updateWelcomeRewardConfig(tenantSlug, prev, fd),
    initialState,
  )

  // Derivado: el reward seleccionado (puede ser null si no hay selección).
  const selectedReward = rewardId ? (availableRewards.find((r) => r.id === rewardId) ?? null) : null

  // Feedback con toasts. Reaccionamos a cambios en state para que cada
  // submission dispare una notificación, no solo el último estado.
  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
    } else if (!state.ok) {
      toast.error(state.message)
    }
  }, [state])

  // Reset: vuelve a los valores iniciales que llegaron del server.
  const handleCancel = () => {
    setEnabled(initialConfig.enabled)
    setRewardId(initialConfig.reward_id)
    setHeadline(initialConfig.headline)
    setSubtext(initialConfig.subtext)
  }

  const hasChanges =
    enabled !== initialConfig.enabled ||
    rewardId !== initialConfig.reward_id ||
    headline !== initialConfig.headline ||
    subtext !== initialConfig.subtext

  // Warning de stock: solo si está seleccionado y tiene stock controlado.
  const isLowStock =
    selectedReward?.stock !== null &&
    selectedReward?.stock !== undefined &&
    selectedReward.stock <= LOW_STOCK_THRESHOLD

  const fieldErrors = !state.ok ? (state.fieldErrors ?? {}) : {}

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-2 lg:gap-8">
      {/* Inputs ocultos: estado del Switch + reward seleccionado.
          El Switch de Radix no expone un input nativo con `name`. */}
      <input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
      <input type="hidden" name="reward_id" value={rewardId ?? ''} />

      {/* === COLUMNA IZQUIERDA: FORM === */}
      <div className="space-y-5">
        {/* Card 1: Toggle principal */}
        <div className="card-hairline rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label
                htmlFor="welcome-enabled"
                className="font-display text-base font-semibold tracking-tight"
              >
                Activar regalo de bienvenida
              </Label>
              <p className="text-xs text-muted-foreground text-pretty">
                Cuando está activo, cada cliente que se registre escaneando el QR recibe la
                recompensa elegida una sola vez.
              </p>
            </div>
            <Switch
              id="welcome-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Activar regalo de bienvenida"
            />
          </div>
        </div>

        {/* Card 2: Lista visual de rewards seleccionables */}
        <div
          className={cn(
            'card-hairline rounded-xl border bg-card p-5 transition-opacity',
            !enabled && 'opacity-60',
          )}
        >
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold tracking-tight">
              Seleccionar recompensa
            </h2>
            <p className="text-xs text-muted-foreground">
              Elegí cuál de tus recompensas activas se entrega al registrarse.
            </p>
          </div>

          {/* Lista de rewards como inputs radio nativos con label wrapper.
              Usar radios reales en vez de role="radio" en un <button> mantiene
              la semántica accesible sin romper biome (a11y/useSemanticElements). */}
          <div className="mt-4 space-y-2">
            {availableRewards.map((reward) => {
              const isSelected = rewardId === reward.id
              const isOutOfStock = reward.stock !== null && reward.stock <= 0
              return (
                <label
                  key={reward.id}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-all',
                    'hover:bg-[--cream-tint] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
                    !enabled && 'cursor-not-allowed opacity-70 hover:bg-transparent',
                    isSelected
                      ? 'border-primary/40 bg-primary/5 ring-2 ring-primary'
                      : 'border-border/70 bg-background/40',
                  )}
                >
                  <input
                    type="radio"
                    name="reward_picker"
                    value={reward.id}
                    checked={isSelected}
                    onChange={() => setRewardId(reward.id)}
                    disabled={!enabled}
                    className="sr-only"
                    aria-label={`Elegir ${reward.name} como regalo de bienvenida`}
                  />

                  {/* Thumbnail */}
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-md border border-border/60 bg-[--cream-tint]">
                    {reward.image_url ? (
                      // biome-ignore lint/performance/noImgElement: Next/Image requiere config remota; las imágenes vienen del bucket de Supabase y la admin tolera un img tag
                      <img
                        src={reward.image_url}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground">
                        <Gift className="size-6" aria-hidden />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{reward.name}</p>
                      {isOutOfStock ? (
                        <Badge variant="warning" className="shrink-0">
                          Sin stock
                        </Badge>
                      ) : null}
                    </div>
                    {reward.description ? (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {reward.description}
                      </p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground/80 tabular-nums">
                      Cuesta {reward.cost_points} pts
                    </p>
                  </div>

                  {/* Check visual */}
                  {isSelected ? (
                    <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3.5" aria-hidden />
                    </div>
                  ) : null}
                </label>
              )
            })}
          </div>

          {fieldErrors.reward_id ? (
            <p className="mt-2 text-xs text-destructive">{fieldErrors.reward_id}</p>
          ) : null}

          {/* Warnings inline sobre la selección */}
          {selectedReward && selectedReward.stock !== null && selectedReward.stock <= 0 ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <p className="text-pretty">
                Este reward está sin stock — al cliente no se le entregará hasta que repongas.
              </p>
            </div>
          ) : isLowStock ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <p className="text-pretty">
                Stock bajo en esta recompensa ({selectedReward?.stock} restantes). Considerá reponer
                pronto.
              </p>
            </div>
          ) : null}
        </div>

        {/* Card 3: Mensaje al cliente */}
        <div
          className={cn(
            'card-hairline rounded-xl border bg-card p-5 space-y-4 transition-opacity',
            !enabled && 'opacity-60',
          )}
        >
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold tracking-tight">
              Mensaje al cliente
            </h2>
            <p className="text-xs text-muted-foreground">
              Personalizá qué lee el cliente arriba del regalo en su pantalla.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="headline" className="text-[11px] text-muted-foreground">
                Titular
              </Label>
              <span className="text-[10px] tabular-nums text-muted-foreground/70">
                {headline.length}/{HEADLINE_MAX}
              </span>
            </div>
            <Input
              id="headline"
              name="headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={HEADLINE_MAX}
              required
              disabled={!enabled}
              aria-invalid={fieldErrors.headline ? true : undefined}
              placeholder="Regalo de bienvenida"
            />
            {fieldErrors.headline ? (
              <p className="text-xs text-destructive">{fieldErrors.headline}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="subtext" className="text-[11px] text-muted-foreground">
                Texto descriptivo
              </Label>
              <span className="text-[10px] tabular-nums text-muted-foreground/70">
                {subtext.length}/{SUBTEXT_MAX}
              </span>
            </div>
            <Textarea
              id="subtext"
              name="subtext"
              value={subtext}
              onChange={(e) => setSubtext(e.target.value)}
              maxLength={SUBTEXT_MAX}
              required
              rows={3}
              disabled={!enabled}
              aria-invalid={fieldErrors.subtext ? true : undefined}
              className="resize-none"
              placeholder="Registrate y llevátelo gratis"
            />
            {fieldErrors.subtext ? (
              <p className="text-xs text-destructive">{fieldErrors.subtext}</p>
            ) : null}
          </div>
        </div>

        {/* Footer con acciones */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={handleCancel} disabled={!hasChanges}>
            Descartar cambios
          </Button>
          <SubmitButton />
        </div>
      </div>

      {/* === COLUMNA DERECHA: PREVIEW LIVE === */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <Sparkles className="size-3" aria-hidden />
            Vista previa en el QR del cliente
          </div>

          {/* Mock device frame — div redondeado tipo phone */}
          <div className="relative mx-auto max-w-[320px]">
            <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-background shadow-[0_20px_60px_-15px_rgba(0,0,0,0.18)] ring-1 ring-black/5">
              {/* Notch decorativo */}
              <div className="flex items-center justify-center pt-3">
                <div className="h-1 w-16 rounded-full bg-muted-foreground/30" aria-hidden />
              </div>

              {/* Contenido — mini-hero card del welcome reward */}
              <div className="p-5 pt-4 pb-8 bg-app-gradient">
                <div className="card-hairline relative overflow-hidden rounded-2xl border bg-card shadow-sm">
                  {/* Imagen del reward */}
                  {selectedReward?.image_url ? (
                    <div className="relative aspect-[16/9] w-full overflow-hidden bg-[--cream-tint]">
                      {/* biome-ignore lint/performance/noImgElement: preview interno admin sin config Next/Image */}
                      <img
                        src={selectedReward.image_url}
                        alt=""
                        className="size-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-[16/9] w-full items-center justify-center bg-gradient-to-br from-[--cream-tint] to-secondary">
                      <Gift className="size-10 text-primary/60" aria-hidden />
                    </div>
                  )}

                  <div className="space-y-2 p-4">
                    <p className="font-serif text-lg font-semibold tracking-tight leading-tight text-pretty">
                      {headline || 'Regalo de bienvenida'}
                    </p>
                    <p className="text-xs text-muted-foreground leading-snug text-pretty">
                      {subtext || 'Registrate y llevátelo gratis'}
                    </p>
                    {selectedReward ? (
                      <p className="text-[11px] font-medium text-foreground/70">
                        {selectedReward.name}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      tabIndex={-1}
                      aria-hidden
                      className="mt-2 w-full pointer-events-none"
                    >
                      Lo quiero
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                </div>

                <p className="mt-4 text-center text-[10px] text-muted-foreground/70">
                  Preview · QR del comensal
                </p>
              </div>

              {/* Overlay "desactivado" */}
              {!enabled ? (
                <div className="absolute inset-0 flex items-center justify-center bg-background/85 backdrop-blur-[2px]">
                  <div className="rounded-full border border-border/70 bg-card px-4 py-2 text-xs font-medium text-muted-foreground shadow-sm">
                    Desactivado — el cliente no verá nada
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </aside>
    </form>
  )
}
