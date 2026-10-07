'use client'

import { ArrowRight, CircleAlert, Gift, Sparkles } from 'lucide-react'
import { startTransition, useActionState, useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { StorageImage } from '@/components/media/storage-image'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Card } from '@/components/ui/card'
import { Field, FormSection, useFocusFirstInvalid } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import { StatusBadge } from '@/components/ui/status-badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { formatNumber } from '@/lib/format/number-kind'
import type { Reward } from '@/lib/points/queries'
import { cn } from '@/lib/utils'
import {
  updateWelcomeRewardConfig,
  type WelcomeRewardActionState,
} from '@/lib/welcome-reward/actions'
import type { WelcomeRewardConfigWithReward } from '@/lib/welcome-reward/queries'
import { REWARD_FLAG } from '../../_components/club-status'

const HEADLINE_MAX = 80
const SUBTEXT_MAX = 160
const LOW_STOCK_THRESHOLD = 5

const initialState: WelcomeRewardActionState = { ok: true }

export function WelcomeRewardForm({
  tenantSlug,
  initialConfig,
  availableRewards,
}: {
  tenantSlug: string
  initialConfig: WelcomeRewardConfigWithReward
  availableRewards: Reward[]
}) {
  const pickerErrorId = useId()
  const formRef = useRef<HTMLFormElement>(null)

  // Estados locales — el form es controlado para que el preview reaccione live.
  const [enabled, setEnabled] = useState(initialConfig.enabled)
  const [rewardId, setRewardId] = useState<string | null>(initialConfig.reward_id)
  const [headline, setHeadline] = useState(initialConfig.headline)
  const [subtext, setSubtext] = useState(initialConfig.subtext)
  const [bonusPoints, setBonusPoints] = useState<number | null>(initialConfig.bonus_points ?? 0)

  const [state, dispatch, pending] = useActionState<WelcomeRewardActionState, FormData>(
    (prev, fd) => updateWelcomeRewardConfig(tenantSlug, prev, fd),
    initialState,
  )

  // Con onSubmit la barra de acciones no ve el envío: el foco al primer campo
  // con error (si el server marcó alguno) lo pone este hook.
  useFocusFirstInvalid(formRef, state)

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
    setBonusPoints(initialConfig.bonus_points ?? 0)
  }

  // onSubmit (no `action`): un `<form action>` resetea los campos al volver del
  // server, también cuando rechaza; acá lo tipeado queda hasta que se guarda.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(() => dispatch(formData))
  }

  const hasChanges =
    enabled !== initialConfig.enabled ||
    rewardId !== initialConfig.reward_id ||
    headline !== initialConfig.headline ||
    subtext !== initialConfig.subtext ||
    (bonusPoints ?? 0) !== (initialConfig.bonus_points ?? 0)

  // Warning de stock: solo si está seleccionado y tiene stock controlado.
  const isOutOfStock =
    selectedReward !== null && selectedReward.stock !== null && selectedReward.stock <= 0
  const isLowStock =
    !isOutOfStock &&
    selectedReward?.stock !== null &&
    selectedReward?.stock !== undefined &&
    selectedReward.stock <= LOW_STOCK_THRESHOLD

  const fieldErrors = !state.ok ? (state.fieldErrors ?? {}) : {}

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="grid gap-8 lg:grid-cols-2 lg:items-start"
    >
      {/* Estado del Switch y recompensa elegida: viajan en el FormData. */}
      <input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
      <input type="hidden" name="reward_id" value={rewardId ?? ''} />

      {/* === COLUMNA IZQUIERDA: FORM === */}
      <Card className="gap-0">
        <FormSection>
          <Field
            label="Activar regalo de bienvenida"
            layout="toggle"
            hint="Cada cliente que se registra escaneando el QR recibe la recompensa elegida, una sola vez."
          >
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </Field>
        </FormSection>

        <FormSection
          title="Qué recompensa se lleva"
          description={
            enabled
              ? 'Elegí cuál de tus recompensas activas se entrega al registrarse.'
              : 'Activá el regalo para elegir la recompensa.'
          }
        >
          <div role="radiogroup" aria-label="Recompensa de bienvenida" className="grid gap-2">
            {availableRewards.map((reward) => {
              const isSelected = rewardId === reward.id
              const soldOut = reward.stock !== null && reward.stock <= 0
              return (
                <label
                  key={reward.id}
                  className={cn(
                    'relative flex min-h-16 items-center gap-3 rounded-lg border bg-card p-3 pe-10 text-left',
                    'transition-colors duration-(--duration-quick)',
                    'outline-offset-2 outline-(--ring) has-[:focus-visible]:outline-2',
                    isSelected ? 'border-primary ring-1 ring-primary' : 'border-border-strong',
                    enabled ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-60',
                  )}
                >
                  <input
                    type="radio"
                    name="reward_picker"
                    value={reward.id}
                    checked={isSelected}
                    onChange={() => setRewardId(reward.id)}
                    disabled={!enabled}
                    // El error va en cada opción: así el foco al primer error
                    // entra al grupo y el lector lee el motivo.
                    aria-invalid={fieldErrors.reward_id ? true : undefined}
                    aria-describedby={fieldErrors.reward_id ? pickerErrorId : undefined}
                    className="sr-only"
                  />

                  <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
                    {reward.image_url ? (
                      <StorageImage src={reward.image_url} alt="" sizes="56px" />
                    ) : (
                      <Gift className="size-5 text-subtle-foreground" aria-hidden="true" />
                    )}
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate type-body font-medium">{reward.name}</span>
                      {soldOut ? <StatusBadge status="sold-out" map={REWARD_FLAG} /> : null}
                    </span>
                    {reward.description ? (
                      <span className="line-clamp-1 type-caption text-muted-foreground">
                        {reward.description}
                      </span>
                    ) : null}
                    <span className="type-caption type-amount text-muted-foreground">
                      Cuesta {formatNumber(reward.cost_points)} pts
                    </span>
                  </span>

                  {/* El punto de radio: forma además de color (como RadioCards). */}
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    focusable="false"
                    className={cn(
                      'absolute end-3 top-3 size-4',
                      isSelected ? 'text-primary' : 'text-input',
                    )}
                  >
                    <circle
                      cx="8"
                      cy="8"
                      r="7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    {isSelected ? <circle cx="8" cy="8" r="3.5" fill="currentColor" /> : null}
                  </svg>
                </label>
              )
            })}
          </div>

          {fieldErrors.reward_id ? (
            <p
              id={pickerErrorId}
              className="flex items-start gap-1 type-caption text-destructive-text"
            >
              <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>{fieldErrors.reward_id}</span>
            </p>
          ) : null}

          {/* Avisos sobre la recompensa elegida */}
          {isOutOfStock ? (
            <Callout tone="warning">
              Esta recompensa está sin stock: al cliente no se le entrega hasta que repongas.
            </Callout>
          ) : isLowStock ? (
            <Callout tone="warning">
              Le quedan {selectedReward?.stock} a esta recompensa. Pensá en reponer pronto.
            </Callout>
          ) : null}
        </FormSection>

        <FormSection
          title="Puntos de bienvenida"
          description="Puntos de regalo al unirse al club: un empujón para que empiece a juntar desde el primer día."
        >
          <Field
            label="Puntos iniciales"
            name="bonus_points"
            hint="0 = ninguno."
            className="sm:max-w-56"
          >
            <NumberField
              min={0}
              max={1_000_000}
              step={10}
              suffix="pts"
              value={bonusPoints}
              onValueChange={setBonusPoints}
              readOnly={!enabled}
            />
          </Field>
        </FormSection>

        <FormSection
          title="Mensaje al cliente"
          description="Lo que lee el cliente arriba del regalo, en su pantalla."
        >
          <Field
            label="Titular"
            name="headline"
            required
            error={fieldErrors.headline}
            hint={`${headline.length} / ${HEADLINE_MAX}`}
          >
            <Input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={HEADLINE_MAX}
              readOnly={!enabled}
              placeholder="Regalo de bienvenida"
            />
          </Field>

          <Field label="Texto" name="subtext" required error={fieldErrors.subtext}>
            <Textarea
              value={subtext}
              onChange={(e) => setSubtext(e.target.value)}
              maxLength={SUBTEXT_MAX}
              showCount
              rows={3}
              readOnly={!enabled}
              placeholder="Registrate y llevátelo gratis"
            />
          </Field>
        </FormSection>

        <FormSection>
          <FormActions sticky={false}>
            <Button type="button" variant="secondary" onClick={handleCancel} disabled={!hasChanges}>
              Descartar cambios
            </Button>
            <Button type="submit" loading={pending} loadingText="Guardando…">
              Guardar configuración
            </Button>
          </FormActions>
        </FormSection>
      </Card>

      {/* === COLUMNA DERECHA: VISTA PREVIA === */}
      <aside
        aria-label="Vista previa en el QR del cliente"
        className="flex flex-col gap-3 lg:sticky lg:top-[calc(var(--topbar-h)+2.5rem)]"
      >
        <p className="flex items-center gap-2 type-label text-muted-foreground">
          <Sparkles className="size-4" aria-hidden="true" />
          Vista previa en el QR del cliente
        </p>

        {/* Marco de teléfono: un div redondeado, sin sombra (quieto). */}
        <div className="relative mx-auto w-full max-w-80">
          <div className="relative overflow-hidden rounded-[2rem] border border-border-strong bg-background">
            <div className="flex items-center justify-center pt-3">
              <div className="h-1 w-16 rounded-full bg-border-strong" aria-hidden="true" />
            </div>

            {/* Contenido — mini-hero del regalo de bienvenida */}
            <div className="p-5 pt-4 pb-8">
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                {selectedReward?.image_url ? (
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-secondary">
                    <StorageImage src={selectedReward.image_url} alt="" sizes="320px" />
                  </div>
                ) : (
                  <div className="flex aspect-[16/9] w-full items-center justify-center bg-secondary">
                    <Gift className="size-10 text-subtle-foreground" aria-hidden="true" />
                  </div>
                )}

                <div className="flex flex-col gap-2 p-4">
                  <p className="font-display text-lg font-semibold leading-tight text-pretty">
                    {headline || 'Regalo de bienvenida'}
                  </p>
                  <p className="type-small text-pretty text-muted-foreground">
                    {subtext || 'Registrate y llevátelo gratis'}
                  </p>
                  {selectedReward ? (
                    <p className="type-caption font-medium text-muted-foreground">
                      {selectedReward.name}
                    </p>
                  ) : null}
                  <span
                    aria-hidden="true"
                    className="mt-2 inline-flex h-(--control-sm) w-full items-center justify-center gap-2 rounded-md bg-primary type-label text-primary-foreground"
                  >
                    Lo quiero
                    <ArrowRight className="size-3.5" />
                  </span>
                </div>
              </div>

              <p className="mt-4 text-center type-caption text-subtle-foreground">
                Vista previa · QR del comensal
              </p>
            </div>

            {/* Velo «desactivado» */}
            {!enabled ? (
              <div className="absolute inset-0 flex items-center justify-center bg-background/90 p-4">
                <p className="rounded-full border border-border bg-card px-4 py-2 text-center type-label text-muted-foreground">
                  Desactivado: el cliente no ve nada
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </form>
  )
}
