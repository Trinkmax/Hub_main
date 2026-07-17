'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowLeft, ArrowRight, Calendar, Megaphone, Sparkles, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { WhatsAppBubble } from '@/components/messaging/whatsapp-bubble'
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
import {
  type BroadcastActionState,
  scheduleBroadcast,
  sendBroadcastTest,
} from '@/lib/broadcasts/actions'
import { renderTemplateBodyPreview } from '@/lib/broadcasts/preview'
import { templateBodyParamCount, type VariableMapping } from '@/lib/broadcasts/variables'
import { fillExamples, parseMetaComponents } from '@/lib/meta/template-components'

type Channel = { id: string; type: 'whatsapp' | 'instagram'; display_name: string | null }
type Template = {
  id: string
  name: string
  language: string
  channel_id: string
  components: unknown
}
type Audience = { id: string; name: string; customer_count_cached: number }
type EventOption = { id: string; name: string; date: string; time: string }

function eventShortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return format(new Date(y, m - 1, d), "d 'de' MMM", { locale: es })
}

const initial: BroadcastActionState = { ok: true }

const STEPS = [
  { label: 'Canal', description: 'Por dónde lo mandás' },
  { label: 'Mensaje', description: 'Qué plantilla usás' },
  { label: 'Personalizar', description: 'Completá los huecos' },
  { label: 'Audiencia', description: 'A quién le llega' },
  { label: 'Detalles', description: 'Nombre y horario' },
  { label: 'Revisar', description: 'Antes de enviar' },
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
  const [mapping, setMapping] = useState<VariableMapping>({})

  const filteredTemplates = useMemo(
    () => templates.filter((t) => !channelId || t.channel_id === channelId),
    [templates, channelId],
  )
  const channel = channels.find((c) => c.id === channelId)
  const template = filteredTemplates.find((t) => t.id === templateId)
  const audience = audiences.find((a) => a.id === audienceId)
  const paramCount = useMemo(() => templateBodyParamCount(template?.components), [template])
  const parsedTemplate = useMemo(() => parseMetaComponents(template?.components), [template])
  const previewValues = useMemo(
    () =>
      Array.from({ length: paramCount }).map((_, i) => {
        const d = mapping[String(i + 1)]
        if (!d) return ''
        if (d.source === 'custom') return d.value ?? `{{${i + 1}}}`
        return d.source === 'first_name' ? 'Ana' : d.source === 'last_name' ? 'Pérez' : '+54…'
      }),
    [paramCount, mapping],
  )

  useEffect(() => {
    if (state.ok && state.id) {
      toast.success(scheduledAt ? 'Difusión programada.' : 'Difusión enviada.')
      router.push(`/${tenantSlug}/mensajeria/difusiones/${state.id}`)
      router.refresh()
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state, router, tenantSlug, scheduledAt])

  const maxStep = STEPS.length - 1

  const canNext = (() => {
    if (step === 0) return channels.length > 0 && channelId.length > 0
    if (step === 1) return templateId.length > 0
    if (step === 2) return true // Variables step — always can advance
    if (step === 3) return audienceId.length > 0
    if (step === 4) return name.length > 0
    return true
  })()

  return (
    <>
      <form action={action} className="space-y-6">
        <input type="hidden" name="channel_id" value={channelId} />
        <input type="hidden" name="template_id" value={templateId} />
        <input type="hidden" name="audience_id" value={audienceId} />
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="scheduled_at" value={scheduledAt} />
        <input type="hidden" name="variable_mapping" value={JSON.stringify(mapping)} />

        <Stepper steps={STEPS} current={step} />

        <div className="card-hairline rounded-xl border bg-card p-5 sm:p-6">
          {step === 0 ? (
            <div className="space-y-3">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  ¿Por dónde lo mandás?
                </h2>
                <p className="text-sm text-muted-foreground">
                  Solo aparecen los canales conectados.
                </p>
              </div>
              {channels.length === 0 ? (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
                  <p className="font-medium text-warning">No hay canales conectados</p>
                  <p className="mt-1 text-muted-foreground">
                    Conectá WhatsApp en Mensajería → Canales antes de crear una difusión.
                  </p>
                </div>
              ) : (
                <Select value={channelId} onValueChange={setChannelId}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Elegí por dónde" />
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
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  ¿Qué mensaje mandás?
                </h2>
                <p className="text-sm text-muted-foreground">De tus plantillas ya aprobadas.</p>
              </div>
              {filteredTemplates.length === 0 ? (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
                  <p className="font-medium text-warning">Todavía no tenés mensajes listos</p>
                  <p className="mt-1 text-muted-foreground">
                    Creá una plantilla en Mensajería → Plantillas. WhatsApp la revisa (unos minutos)
                    y aparece acá.
                  </p>
                </div>
              ) : (
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Elegí una plantilla" />
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
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  Completá los huecos del mensaje
                </h2>
                <p className="text-sm text-muted-foreground">
                  {paramCount === 0
                    ? 'Este mensaje no tiene huecos para completar.'
                    : 'Cada hueco se rellena con un dato de cada cliente, así le llega personalizado.'}
                </p>
              </div>
              {Array.from({ length: paramCount }).map((_, idx) => {
                const key = String(idx + 1)
                const def = mapping[key] ?? { source: 'first_name' as const }
                return (
                  <div key={key} className="grid gap-2 rounded-lg border border-border/60 p-3">
                    <Label>{`Dato ${key}`}</Label>
                    <Select
                      value={def.source}
                      onValueChange={(v) =>
                        setMapping((m) => ({
                          ...m,
                          [key]: { ...m[key], source: v as VariableMapping[string]['source'] },
                        }))
                      }
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="first_name">Nombre</SelectItem>
                        <SelectItem value="last_name">Apellido</SelectItem>
                        <SelectItem value="phone">Teléfono</SelectItem>
                        <SelectItem value="custom">Un texto fijo</SelectItem>
                      </SelectContent>
                    </Select>
                    {def.source === 'custom' ? (
                      <Input
                        placeholder="El texto que va acá"
                        value={def.value ?? ''}
                        onChange={(e) =>
                          setMapping((m) => ({
                            ...m,
                            [key]: { ...m[key], source: 'custom', value: e.target.value },
                          }))
                        }
                      />
                    ) : (
                      <Input
                        placeholder="Qué poner si el cliente no tiene este dato"
                        value={def.fallback ?? ''}
                        onChange={(e) =>
                          setMapping((m) => {
                            const prev = m[key] ?? { source: 'first_name' as const }
                            return { ...m, [key]: { ...prev, fallback: e.target.value } }
                          })
                        }
                      />
                    )}
                  </div>
                )
              })}
              {paramCount > 0 ? (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                    Vista previa
                  </p>
                  <p className="whitespace-pre-wrap">
                    {renderTemplateBodyPreview(template?.components, previewValues)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">¿A quién?</h2>
                <p className="text-sm text-muted-foreground">
                  La lista se actualiza sola justo antes de enviar.
                </p>
              </div>
              {audiences.length === 0 ? (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
                  <p className="font-medium text-warning">Sin audiencias</p>
                  <p className="mt-1 text-muted-foreground">
                    Creá una lista primero en Mensajería → Audiencias.
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

          {step === 4 ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">Detalles</h2>
                <p className="text-sm text-muted-foreground">
                  Un nombre para vos (los clientes no lo ven) y cuándo enviar.
                </p>
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
                <Label htmlFor="name-input">Nombre (solo para vos)</Label>
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
                <p className="text-[11px] text-muted-foreground">
                  Si lo dejás en blanco, se envía ni bien confirmes.
                </p>
              </div>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  Revisión final
                </h2>
                <p className="text-sm text-muted-foreground">
                  Revisá que esté todo bien antes de enviar.
                </p>
              </div>
              <dl className="grid gap-3">
                <SummaryRow
                  icon={Megaphone}
                  label="Canal"
                  value={channel?.display_name ?? channel?.type ?? '—'}
                />
                <SummaryRow
                  icon={Sparkles}
                  label="Mensaje"
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

              {template ? (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Vista previa del mensaje
                  </p>
                  <WhatsAppBubble
                    header={
                      parsedTemplate.header
                        ? fillExamples(parsedTemplate.header, previewValues)
                        : null
                    }
                    body={renderTemplateBodyPreview(template.components, previewValues)}
                    footer={parsedTemplate.footer}
                    buttons={parsedTemplate.buttons.map((text, i) => ({ id: `b-${i}`, text }))}
                  />
                </div>
              ) : null}

              <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Se envía sólo a los clientes que{' '}
                <strong className="text-foreground">
                  aceptaron recibir promociones por WhatsApp
                </strong>
                . Los que no aceptaron —o pidieron no recibir más— quedan afuera automáticamente.
              </p>
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
          {step < maxStep ? (
            <Button
              type="button"
              disabled={!canNext}
              onClick={() => setStep((s) => Math.min(maxStep, s + 1))}
              className="gap-1.5"
            >
              Siguiente
              <ArrowRight className="size-3.5" />
            </Button>
          ) : (
            <Button type="submit" disabled={pending} size="lg">
              {pending
                ? scheduledAt
                  ? 'Programando…'
                  : 'Enviando…'
                : scheduledAt
                  ? 'Programar envío'
                  : 'Enviar ahora'}
            </Button>
          )}
        </div>
      </form>

      <TestSendBlock
        tenantSlug={tenantSlug}
        channelId={channelId}
        templateId={templateId}
        mapping={mapping}
      />
    </>
  )
}

function TestSendBlock({
  tenantSlug,
  channelId,
  templateId,
  mapping,
}: {
  tenantSlug: string
  channelId: string
  templateId: string
  mapping: VariableMapping
}) {
  const [state, action, pending] = useActionState(sendBroadcastTest.bind(null, tenantSlug), {
    ok: true,
  } as BroadcastActionState)
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message)
    else if (!state.ok && state.message) toast.error(state.message)
  }, [state])
  if (!channelId || !templateId) return null
  return (
    <form action={action} className="mt-4 flex items-end gap-2 rounded-lg border border-dashed p-3">
      <input type="hidden" name="channel_id" value={channelId} />
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="variable_mapping" value={JSON.stringify(mapping)} />
      <div className="grid flex-1 gap-1.5">
        <Label htmlFor="test-phone">Enviar prueba a</Label>
        <Input id="test-phone" name="to_phone" placeholder="+54 9 351 …" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Enviando…' : 'Enviar prueba'}
      </Button>
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
