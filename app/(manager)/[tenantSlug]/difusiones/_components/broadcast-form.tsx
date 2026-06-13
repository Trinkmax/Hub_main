'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowLeft, ArrowRight, Calendar, Megaphone, Sparkles, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Stepper } from '@/components/ui/stepper'
import { type BroadcastActionState, scheduleBroadcast } from '@/lib/broadcasts/actions'

type Channel = { id: string; type: 'whatsapp' | 'instagram'; display_name: string | null }
type Template = { id: string; name: string; language: string; channel_id: string }
type Audience = { id: string; name: string; customer_count_cached: number }
type EventOption = { id: string; name: string; date: string; time: string }

function eventShortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return format(new Date(y, m - 1, d), "d 'de' MMM", { locale: es })
}

const initial: BroadcastActionState = { ok: true }

const STEPS = [
  { label: 'Canal', description: 'WhatsApp o Instagram' },
  { label: 'Template', description: 'Mensaje aprobado' },
  { label: 'Audiencia', description: 'A quién mandar' },
  { label: 'Detalles', description: 'Nombre y horario' },
  { label: 'Confirmar', description: 'Revisión final' },
]

export function BroadcastForm({
  tenantSlug,
  channels,
  templates,
  audiences,
  events = [],
  initialName = '',
}: {
  tenantSlug: string
  channels: Channel[]
  templates: Template[]
  audiences: Audience[]
  events?: EventOption[]
  initialName?: string
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(scheduleBroadcast.bind(null, tenantSlug), initial)
  const [step, setStep] = useState(0)
  const [name, setName] = useState(initialName)
  const [channelId, setChannelId] = useState<string>('')
  const [templateId, setTemplateId] = useState<string>('')
  const [audienceId, setAudienceId] = useState<string>('')
  const [eventId, setEventId] = useState<string>('')
  const [scheduledAt, setScheduledAt] = useState<string>('')

  const filteredTemplates = useMemo(
    () => templates.filter((t) => !channelId || t.channel_id === channelId),
    [templates, channelId],
  )
  const channel = channels.find((c) => c.id === channelId)
  const template = filteredTemplates.find((t) => t.id === templateId)
  const audience = audiences.find((a) => a.id === audienceId)

  useEffect(() => {
    if (state.ok && state.id) {
      toast.success('Difusión programada.')
      router.push(`/${tenantSlug}/difusiones/${state.id}`)
      router.refresh()
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state, router, tenantSlug])

  const canNext = (() => {
    if (step === 0) return channels.length > 0 && channelId.length > 0
    if (step === 1) return templateId.length > 0
    if (step === 2) return audienceId.length > 0
    if (step === 3) return name.length > 0
    return true
  })()

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="channel_id" value={channelId} />
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="audience_id" value={audienceId} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="scheduled_at" value={scheduledAt} />

      <Stepper steps={STEPS} current={step} />

      <div className="card-hairline rounded-xl border bg-card p-5 sm:p-6">
        {step === 0 ? (
          <div className="space-y-3">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight">¿Por qué canal?</h2>
              <p className="text-sm text-muted-foreground">Solo aparecen los canales conectados.</p>
            </div>
            {channels.length === 0 ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
                <p className="font-medium text-warning">No hay canales conectados</p>
                <p className="mt-1 text-muted-foreground">
                  Conectá WhatsApp en Configuración → Canales antes de programar una difusión.
                </p>
              </div>
            ) : (
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Elegí canal" />
                </SelectTrigger>
                <SelectContent>
                  {channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className={`size-1.5 rounded-full ${c.type === 'whatsapp' ? 'bg-success' : 'bg-warning'}`}
                        />
                        {c.display_name ?? c.type}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight">¿Qué template?</h2>
              <p className="text-sm text-muted-foreground">Solo aparecen los aprobados por Meta.</p>
            </div>
            {filteredTemplates.length === 0 ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
                <p className="font-medium text-warning">Sin templates aprobados</p>
                <p className="mt-1 text-muted-foreground">
                  Sincronizá en Configuración → Plantillas y esperá la aprobación de Meta.
                </p>
              </div>
            ) : (
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Elegí template" />
                </SelectTrigger>
                <SelectContent>
                  {filteredTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} <span className="ml-1 text-muted-foreground">({t.language})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight">¿A quién?</h2>
              <p className="text-sm text-muted-foreground">
                La audiencia se recalcula antes del envío.
              </p>
            </div>
            {audiences.length === 0 ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
                <p className="font-medium text-warning">Sin audiencias</p>
                <p className="mt-1 text-muted-foreground">
                  Creá una audiencia primero en Marketing → Audiencias.
                </p>
              </div>
            ) : (
              <Select value={audienceId} onValueChange={setAudienceId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Elegí audiencia" />
                </SelectTrigger>
                <SelectContent>
                  {audiences.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        {a.name}
                        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] tabular-nums">
                          {a.customer_count_cached}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight">Detalles</h2>
              <p className="text-sm text-muted-foreground">Un nombre interno y cuándo enviar.</p>
            </div>
            {events.length > 0 ? (
              <div className="grid gap-1.5">
                <Label htmlFor="event-input">Evento (opcional)</Label>
                <Select
                  value={eventId}
                  onValueChange={(v) => {
                    setEventId(v)
                    const ev = events.find((e) => e.id === v)
                    if (ev) setName(`${ev.name} · ${eventShortDate(ev.date)}`)
                  }}
                >
                  <SelectTrigger id="event-input" className="h-11">
                    <SelectValue placeholder="Anunciar un evento del calendario…" />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}{' '}
                        <span className="ml-1 text-muted-foreground">
                          · {eventShortDate(e.date)} {e.time}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Elegir un evento completa el nombre de la difusión.
                </p>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="name-input">Nombre interno</Label>
              <Input
                id="name-input"
                placeholder="Ej: Septiembre · peña folklórica"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="scheduled-at-input">Cuándo enviar</Label>
              <Input
                id="scheduled-at-input"
                type="datetime-local"
                value={scheduledAt.slice(0, 16)}
                onChange={(e) =>
                  setScheduledAt(e.target.value ? new Date(e.target.value).toISOString() : '')
                }
              />
              <p className="text-[11px] text-muted-foreground">Vacío = enviar ahora.</p>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight">Revisión final</h2>
              <p className="text-sm text-muted-foreground">Verificá antes de programar.</p>
            </div>
            <dl className="grid gap-3">
              <SummaryRow
                icon={Megaphone}
                label="Canal"
                value={channel?.display_name ?? channel?.type ?? '—'}
              />
              <SummaryRow
                icon={Sparkles}
                label="Template"
                value={template ? `${template.name} (${template.language})` : '—'}
              />
              <SummaryRow
                icon={Users}
                label="Audiencia"
                value={
                  audience
                    ? `${audience.name} · ${audience.customer_count_cached.toLocaleString('es-AR')} clientes`
                    : '—'
                }
              />
              <SummaryRow
                icon={Calendar}
                label="Cuándo"
                value={
                  scheduledAt
                    ? format(new Date(scheduledAt), "d 'de' MMMM 'de' yyyy 'a las' HH:mm", {
                        locale: es,
                      })
                    : 'Ahora mismo'
                }
              />
            </dl>
          </div>
        ) : null}
      </div>

      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="gap-1.5"
        >
          <ArrowLeft className="size-3.5" />
          Atrás
        </Button>
        {step < 4 ? (
          <Button
            type="button"
            disabled={!canNext}
            onClick={() => setStep((s) => Math.min(4, s + 1))}
            className="gap-1.5"
          >
            Siguiente
            <ArrowRight className="size-3.5" />
          </Button>
        ) : (
          <Button type="submit" disabled={pending} size="lg">
            {pending ? 'Programando…' : 'Programar difusión'}
          </Button>
        )}
      </div>
    </form>
  )
}

function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Megaphone
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
      </div>
    </div>
  )
}
