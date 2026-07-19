'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowLeft, ArrowRight, Calendar, Megaphone, Send, Sparkles, Users } from 'lucide-react'
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
import { formatPhoneForDisplay } from '@/lib/phone'

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

// Ejemplo con el que se arma la vista previa (una clienta inventada).
const EXAMPLE = {
  first_name: 'Ana',
  last_name: 'Pérez',
  phone: formatPhoneForDisplay('+5493515551234'),
}

const STEPS = [
  { label: 'Canal', description: 'Por dónde sale' },
  { label: 'Mensaje', description: 'Cuál mandás' },
  { label: 'Personalizar', description: 'Datos de cada cliente' },
  { label: 'Destinatarios', description: 'A quién le llega' },
  { label: 'Nombre y fecha', description: 'Cuándo sale' },
  { label: 'Revisar', description: 'Y enviar' },
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

  // Completa el mapping con el default visible ("Nombre") para cada hueco.
  // Sin esto, la UI mostraba "Nombre" pero se enviaba el hueco vacío.
  useEffect(() => {
    if (!templateId || paramCount === 0) return
    setMapping((m) => {
      let changed = false
      const next = { ...m }
      for (let i = 1; i <= paramCount; i += 1) {
        const key = String(i)
        if (!next[key]) {
          next[key] = { source: 'first_name' }
          changed = true
        }
      }
      return changed ? next : m
    })
  }, [templateId, paramCount])

  const previewValues = useMemo(
    () =>
      Array.from({ length: paramCount }).map((_, i) => {
        const d = mapping[String(i + 1)]
        const source = d?.source ?? 'first_name'
        if (source === 'custom') {
          const fixed = d?.value?.trim()
          return fixed && fixed.length > 0 ? fixed : '…'
        }
        return EXAMPLE[source]
      }),
    [paramCount, mapping],
  )

  useEffect(() => {
    if (state.ok && state.id) {
      toast.success(
        scheduledAt
          ? 'Listo. La difusión quedó programada.'
          : 'Listo. La difusión ya está saliendo.',
      )
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
    if (step === 2) return true // Personalizar — siempre se puede avanzar
    if (step === 3) return audienceId.length > 0
    if (step === 4) return name.length > 0
    return true
  })()

  const bubblePreview = template ? (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Así lo va a ver el cliente{paramCount > 0 ? ' (ejemplo: Ana Pérez)' : ''}
      </p>
      <WhatsAppBubble
        header={parsedTemplate.header ? fillExamples(parsedTemplate.header, previewValues) : null}
        body={renderTemplateBodyPreview(template.components, previewValues)}
        footer={parsedTemplate.footer}
        buttons={parsedTemplate.buttons.map((text, i) => ({ id: `b-${i}`, text }))}
      />
    </div>
  ) : null

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
                  <SelectTrigger className="h-11" aria-label="Canal de envío">
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
                <p className="text-sm text-muted-foreground">
                  Elegí uno de tus mensajes ya aprobados por WhatsApp.
                </p>
              </div>
              {filteredTemplates.length === 0 ? (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
                  <p className="font-medium text-warning">Todavía no tenés mensajes listos</p>
                  <p className="mt-1 text-muted-foreground">
                    Creá uno en Mensajería → Plantillas. WhatsApp lo revisa (suelen ser unos
                    minutos) y aparece acá.
                  </p>
                </div>
              ) : (
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger className="h-11" aria-label="Mensaje aprobado">
                    <SelectValue placeholder="Elegí un mensaje" />
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
              {bubblePreview}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  Hacelo personal
                </h2>
                <p className="text-sm text-muted-foreground">
                  {paramCount === 0
                    ? 'Este mensaje sale igual para todos. No hay nada que completar acá.'
                    : 'El mensaje tiene huecos que se completan con un dato de cada cliente. Elegí qué va en cada uno.'}
                </p>
              </div>
              {Array.from({ length: paramCount }).map((_, idx) => {
                const key = String(idx + 1)
                const def = mapping[key] ?? { source: 'first_name' as const }
                return (
                  <div
                    key={key}
                    className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-3"
                  >
                    <Label htmlFor={`hueco-${key}`}>
                      {paramCount === 1 ? '¿Qué va en el hueco?' : `¿Qué va en el hueco ${key}?`}
                    </Label>
                    <Select
                      value={def.source}
                      onValueChange={(v) =>
                        setMapping((m) => ({
                          ...m,
                          [key]: { ...m[key], source: v as VariableMapping[string]['source'] },
                        }))
                      }
                    >
                      <SelectTrigger id={`hueco-${key}`} className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="first_name">El nombre del cliente</SelectItem>
                        <SelectItem value="last_name">El apellido del cliente</SelectItem>
                        <SelectItem value="phone">El teléfono del cliente</SelectItem>
                        <SelectItem value="custom">Un texto fijo, igual para todos</SelectItem>
                      </SelectContent>
                    </Select>
                    {def.source === 'custom' ? (
                      <Input
                        aria-label={`Texto fijo para el hueco ${key}`}
                        placeholder="Escribí el texto que va acá"
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
                        aria-label={`Texto de respaldo para el hueco ${key}`}
                        placeholder="Si a un cliente le falta ese dato, poné esto"
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
              {bubblePreview}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  ¿A quién se lo mandás?
                </h2>
                <p className="text-sm text-muted-foreground">
                  Elegí una de tus listas. Se actualiza sola justo antes de enviar.
                </p>
              </div>
              {audiences.length === 0 ? (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
                  <p className="font-medium text-warning">Todavía no armaste ninguna lista</p>
                  <p className="mt-1 text-muted-foreground">
                    Creá una en Mensajería → Audiencias y volvé acá.
                  </p>
                </div>
              ) : (
                <>
                  <Select value={audienceId} onValueChange={setAudienceId}>
                    <SelectTrigger className="h-11" aria-label="Lista de destinatarios">
                      <SelectValue placeholder="Elegí una lista" />
                    </SelectTrigger>
                    <SelectContent>
                      {audiences.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="flex items-center gap-2">
                            {a.name}
                            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] tabular-nums">
                              {a.customer_count_cached.toLocaleString('es-AR')}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {audience ? (
                    <p className="text-xs text-muted-foreground">
                      Hoy son{' '}
                      <strong className="text-foreground">
                        {audience.customer_count_cached.toLocaleString('es-AR')}{' '}
                        {audience.customer_count_cached === 1 ? 'cliente' : 'clientes'}
                      </strong>
                      . Los que no aceptaron recibir promos quedan afuera solos.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  Nombre y fecha
                </h2>
                <p className="text-sm text-muted-foreground">
                  Un nombre para reconocerla después (los clientes no lo ven) y cuándo sale.
                </p>
              </div>
              {events.length > 0 ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="event-input">¿Es para anunciar un evento? (opcional)</Label>
                  <Select
                    value={eventId}
                    onValueChange={(v) => {
                      setEventId(v)
                      const ev = events.find((e) => e.id === v)
                      if (ev) setName(`${ev.name} · ${eventShortDate(ev.date)}`)
                    }}
                  >
                    <SelectTrigger id="event-input" className="h-11">
                      <SelectValue placeholder="Elegí un evento del calendario…" />
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
                    Al elegirlo, el nombre de la difusión se completa solo.
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
                <Label htmlFor="scheduled-at-input">¿Cuándo sale?</Label>
                <Input
                  id="scheduled-at-input"
                  type="datetime-local"
                  value={scheduledAt.slice(0, 16)}
                  onChange={(e) =>
                    setScheduledAt(e.target.value ? new Date(e.target.value).toISOString() : '')
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  {scheduledAt
                    ? `Sale el ${format(new Date(scheduledAt), "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })}.`
                    : 'Si lo dejás en blanco, se envía ni bien confirmes.'}
                </p>
              </div>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  Último vistazo
                </h2>
                <p className="text-sm text-muted-foreground">
                  Revisá que esté todo bien antes de confirmar.
                </p>
              </div>

              <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm">
                <p>
                  Se lo vas a mandar a{' '}
                  <strong>
                    {audience
                      ? `${audience.customer_count_cached.toLocaleString('es-AR')} ${
                          audience.customer_count_cached === 1 ? 'cliente' : 'clientes'
                        }`
                      : 'los clientes'}
                  </strong>{' '}
                  de la lista “{audience?.name ?? '—'}”,{' '}
                  {scheduledAt
                    ? `el ${format(new Date(scheduledAt), "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })}`
                    : 'ahora mismo, ni bien confirmes'}
                  .
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Solo les llega a los que aceptaron recibir promos. Los que pidieron no recibir más
                  quedan afuera solos.
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
                  label="Destinatarios"
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

              {bubblePreview}
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
            <Button
              type="submit"
              disabled={pending}
              size="lg"
              className={
                scheduledAt
                  ? 'gap-2'
                  : 'gap-2 bg-(--wa-accent) text-white hover:bg-(--wa-accent-deep)'
              }
            >
              <Send className="size-4" aria-hidden />
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
    <div className="mt-6 space-y-3 rounded-xl border border-dashed border-border/80 bg-card/50 p-4">
      <div>
        <p className="text-sm font-medium">Probalo primero en tu WhatsApp</p>
        <p className="text-xs text-muted-foreground">
          Te mandás el mensaje a vos y lo ves tal cual le llega al cliente. No le llega a nadie más.
        </p>
      </div>
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="channel_id" value={channelId} />
        <input type="hidden" name="template_id" value={templateId} />
        <input type="hidden" name="variable_mapping" value={JSON.stringify(mapping)} />
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="test-phone">Tu número</Label>
          <Input id="test-phone" name="to_phone" inputMode="tel" placeholder="Ej: 351 555-1234" />
        </div>
        <Button
          type="submit"
          disabled={pending}
          className="gap-2 bg-(--wa-accent) text-white hover:bg-(--wa-accent-deep)"
        >
          <Send className="size-4" aria-hidden />
          {pending ? 'Enviando…' : 'Mandar prueba'}
        </Button>
      </form>
    </div>
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
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
      </div>
    </div>
  )
}
