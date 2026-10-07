'use client'

import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Megaphone,
  MessageSquareText,
  Send,
  Sparkles,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { WhatsAppBubble } from '@/components/messaging/whatsapp-bubble'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Card } from '@/components/ui/card'
import { Field, FormError, FormSection } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Steps } from '@/components/ui/steps'
import { SubmitButton } from '@/components/ui/submit-button'
import { DateTimeField, splitDateTime } from '@/components/ui/time-field'
import {
  type BroadcastActionState,
  scheduleBroadcast,
  sendBroadcastTest,
} from '@/lib/broadcasts/actions'
import { renderTemplateBodyPreview } from '@/lib/broadcasts/preview'
import {
  TEMPLATE_VARIABLES,
  templateBodyParamCount,
  VARIABLE_SOURCES,
  type VariableMapping,
  type VariableSourceKey,
  variableDefinition,
} from '@/lib/broadcasts/variables'
import {
  cordobaWallTimeToUtc,
  MONTH_NAMES_SHORT,
  monthName,
  todayInCordoba,
  weekdayName,
} from '@/lib/dates'
import { fillExamples, parseMetaComponents } from '@/lib/meta/template-components'
import { formatPhoneForDisplay } from '@/lib/phone'
import { humanizeTemplateName, languageLabel } from '../../plantillas/_template-display'
import { clientesLabel } from './broadcast-status'

type Channel = { id: string; type: 'whatsapp' | 'instagram'; display_name: string | null }
type Template = {
  id: string
  name: string
  language: string
  channel_id: string
  components: unknown
  /** `{"1":"first_name"}` — lo que se eligió al escribir la plantilla. */
  variable_hints?: unknown
}
type Audience = { id: string; name: string; customer_count_cached: number }
type EventOption = { id: string; name: string; date: string; time: string }
type SendMode = 'now' | 'later'

const CHANNEL_TYPE_LABEL: Record<Channel['type'], string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
}

const SEND_MODE_ITEMS = [
  { value: 'now' as const, label: 'Ni bien confirme' },
  { value: 'later' as const, label: 'Programar' },
]

/** `'2026-09-15'` → `'15 de sep'`, escrito a mano (sin `Intl`). */
function eventShortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return `${d} de ${MONTH_NAMES_SHORT[m - 1] ?? ''}`
}

/** `'2026-09-15T21:30'` → `'martes 15 de septiembre a las 21:30'` (hora de Córdoba). */
function whenLabel(local: string): string {
  const { date, time } = splitDateTime(local)
  if (!date || !time) return ''
  const day = Number(date.slice(8, 10))
  return `${weekdayName(date)} ${day} de ${monthName(Number(date.slice(5, 7)))} a las ${time}`
}

/** La hora de reloj de Córdoba elegida → instante UTC, que es lo que guarda la acción. */
function scheduledIso(local: string | null): string {
  const { date, time } = splitDateTime(local)
  if (!date || !time) return ''
  try {
    return cordobaWallTimeToUtc(date, time)
  } catch {
    return ''
  }
}

const initial: BroadcastActionState = { ok: true }

/**
 * `variable_hints` viene como jsonb: lo bajamos a `{posición: fuente}` tirando
 * cualquier clave que no sea una fuente conocida (una plantilla vieja o tocada
 * a mano no puede romper el formulario).
 */
function parseHints(raw: unknown): Record<string, VariableSourceKey> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, VariableSourceKey> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && VARIABLE_SOURCES.includes(value as VariableSourceKey)) {
      out[key] = value as VariableSourceKey
    }
  }
  return out
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
  const [state, action] = useActionState(scheduleBroadcast.bind(null, tenantSlug), initial)
  const [step, setStep] = useState(0)
  const [name, setName] = useState(initialName)
  const [channelId, setChannelId] = useState<string>('')
  const [templateId, setTemplateId] = useState<string>('')
  const [audienceId, setAudienceId] = useState<string>('')
  const [eventId, setEventId] = useState<string>('')
  const [sendMode, setSendMode] = useState<SendMode>('now')
  /** Día y hora elegidos, en hora de Córdoba (`'YYYY-MM-DDTHH:mm'`). */
  const [scheduledLocal, setScheduledLocal] = useState<string | null>(null)
  const [mapping, setMapping] = useState<VariableMapping>({})
  const stepRef = useRef<HTMLDivElement>(null)

  // Programar sin día u hora no programa: queda vacío y no deja seguir. Antes,
  // un campo de fecha a medio llenar mandaba la difusión en el momento.
  const scheduledAt = sendMode === 'later' ? scheduledIso(scheduledLocal) : ''

  const filteredTemplates = useMemo(
    () => templates.filter((t) => !channelId || t.channel_id === channelId),
    [templates, channelId],
  )
  const channel = channels.find((c) => c.id === channelId)
  const template = filteredTemplates.find((t) => t.id === templateId)
  const audience = audiences.find((a) => a.id === audienceId)
  const paramCount = useMemo(() => templateBodyParamCount(template?.components), [template])
  const parsedTemplate = useMemo(() => parseMetaComponents(template?.components), [template])
  const hints = useMemo(() => parseHints(template?.variable_hints), [template])

  // Precarga cada hueco con lo que se eligió al escribir la plantilla
  // (`variable_hints`); si esa plantilla es vieja y no lo tiene, cae en
  // "Nombre". Sin esto la UI mostraba "Nombre" pero se enviaba el hueco vacío.
  useEffect(() => {
    if (!templateId || paramCount === 0) return
    setMapping((m) => {
      let changed = false
      const next = { ...m }
      for (let i = 1; i <= paramCount; i += 1) {
        const key = String(i)
        if (!next[key]) {
          const hint = hints[key]
          next[key] = { source: hint ?? 'first_name' }
          changed = true
        }
      }
      return changed ? next : m
    })
  }, [templateId, paramCount, hints])

  const previewValues = useMemo(
    () =>
      Array.from({ length: paramCount }).map((_, i) => {
        const d = mapping[String(i + 1)]
        const source = d?.source ?? 'first_name'
        if (source === 'custom') {
          const fixed = d?.value?.trim()
          return fixed && fixed.length > 0 ? fixed : '…'
        }
        return source === 'phone'
          ? formatPhoneForDisplay('+5493515551234')
          : (variableDefinition(source)?.example ?? '…')
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
    }
  }, [state, router, tenantSlug, scheduledAt])

  // Al cambiar de paso, el foco va al paso nuevo: el lector de pantalla arranca
  // por su título y con el teclado no hay que volver a buscar dónde seguir.
  // (Comparado contra el último paso y no con un «primera vez»: el doble efecto
  // del modo estricto no le roba el foco a nadie al montar.)
  const lastStep = useRef(step)
  useEffect(() => {
    if (lastStep.current === step) return
    lastStep.current = step
    stepRef.current?.focus({ preventScroll: false })
  }, [step])

  const maxStep = STEPS.length - 1

  const canNext = (() => {
    if (step === 0) return channels.length > 0 && channelId.length > 0
    if (step === 1) return templateId.length > 0
    if (step === 2) return true // Personalizar — siempre se puede avanzar
    if (step === 3) return audienceId.length > 0
    if (step === 4) return name.trim().length > 0 && (sendMode === 'now' || scheduledAt !== '')
    return true
  })()

  const audienceCount = audience ? clientesLabel(audience.customer_count_cached) : null
  const whenText = scheduledAt && scheduledLocal ? whenLabel(scheduledLocal) : null

  const bubblePreview = template ? (
    <div className="flex flex-col gap-2">
      <p className="type-caption text-muted-foreground">
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
      <form action={action} className="flex flex-col gap-6">
        <input type="hidden" name="channel_id" value={channelId} />
        <input type="hidden" name="template_id" value={templateId} />
        <input type="hidden" name="audience_id" value={audienceId} />
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="scheduled_at" value={scheduledAt} />
        <input type="hidden" name="variable_mapping" value={JSON.stringify(mapping)} />

        <FormError title="No se pudo crear la difusión" message={state.ok ? null : state.message} />

        <Steps steps={STEPS} current={step} />

        <Card>
          <div ref={stepRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
            {step === 0 ? (
              <FormSection
                title="¿Por dónde lo mandás?"
                description="Solo aparecen los canales conectados."
              >
                {channels.length === 0 ? (
                  <Callout
                    tone="warning"
                    title="No hay canales conectados"
                    action={
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`/${tenantSlug}/mensajeria/canales`}>Ir a Canales</Link>
                      </Button>
                    }
                  >
                    Conectá WhatsApp en Canales antes de crear una difusión.
                  </Callout>
                ) : (
                  <Field label="Canal de envío" labelHidden>
                    <Select value={channelId} onValueChange={setChannelId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí por dónde" />
                      </SelectTrigger>
                      <SelectContent>
                        {channels.map((c) => (
                          <SelectItem
                            key={c.id}
                            value={c.id}
                            description={c.display_name ? CHANNEL_TYPE_LABEL[c.type] : undefined}
                          >
                            {c.display_name ?? CHANNEL_TYPE_LABEL[c.type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </FormSection>
            ) : null}

            {step === 1 ? (
              <FormSection
                title="¿Qué mensaje mandás?"
                description="Elegí uno de tus mensajes ya aprobados por WhatsApp."
              >
                {filteredTemplates.length === 0 ? (
                  <Callout
                    tone="warning"
                    title="Todavía no tenés mensajes listos"
                    action={
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`/${tenantSlug}/mensajeria/plantillas`}>
                          <MessageSquareText aria-hidden />
                          Escribir una plantilla
                        </Link>
                      </Button>
                    }
                  >
                    Se escriben desde acá mismo, no hace falta entrar a Meta: WhatsApp lo revisa
                    (suelen ser unos minutos) y aparece en esta lista.
                  </Callout>
                ) : (
                  <Field label="Mensaje aprobado" labelHidden>
                    <Select value={templateId} onValueChange={setTemplateId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí un mensaje" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredTemplates.map((t) => (
                          <SelectItem
                            key={t.id}
                            value={t.id}
                            description={languageLabel(t.language)}
                          >
                            {humanizeTemplateName(t.name)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                {bubblePreview}
              </FormSection>
            ) : null}

            {step === 2 ? (
              <FormSection
                title="Hacelo personal"
                description={
                  paramCount === 0
                    ? 'Este mensaje sale igual para todos. No hay nada que completar acá.'
                    : 'El mensaje tiene huecos que se completan con un dato de cada cliente. Elegí qué va en cada uno.'
                }
              >
                {paramCount > 0 ? (
                  <div className="flex flex-col divide-y divide-border">
                    {Array.from({ length: paramCount }).map((_, idx) => {
                      const key = String(idx + 1)
                      const def = mapping[key] ?? { source: 'first_name' as const }
                      return (
                        <div key={key} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                          <Field
                            label={
                              paramCount === 1
                                ? '¿Qué va en el hueco?'
                                : `¿Qué va en el hueco ${key}?`
                            }
                          >
                            <Select
                              value={def.source}
                              onValueChange={(v) =>
                                setMapping((m) => ({
                                  ...m,
                                  [key]: {
                                    ...m[key],
                                    source: v as VariableMapping[string]['source'],
                                  },
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TEMPLATE_VARIABLES.map((v) => (
                                  <SelectItem key={v.key} value={v.key}>
                                    {v.longLabel}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          {def.source === 'custom' ? (
                            <Field label="Texto fijo" hint="Les llega igual a todos.">
                              <Input
                                placeholder="Escribí el texto que va acá"
                                value={def.value ?? ''}
                                onChange={(e) =>
                                  setMapping((m) => ({
                                    ...m,
                                    [key]: { ...m[key], source: 'custom', value: e.target.value },
                                  }))
                                }
                              />
                            </Field>
                          ) : (
                            <Field
                              label="Si a un cliente le falta ese dato"
                              optional
                              hint="Va esto en su lugar, para que el mensaje no quede cortado."
                            >
                              <Input
                                placeholder="Ej: amigo, amiga"
                                value={def.fallback ?? ''}
                                onChange={(e) =>
                                  setMapping((m) => {
                                    const prev = m[key] ?? { source: 'first_name' as const }
                                    return { ...m, [key]: { ...prev, fallback: e.target.value } }
                                  })
                                }
                              />
                            </Field>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : null}
                {bubblePreview}
              </FormSection>
            ) : null}

            {step === 3 ? (
              <FormSection
                title="¿A quién se lo mandás?"
                description="Elegí una de tus listas. Se actualiza sola justo antes de enviar."
              >
                {audiences.length === 0 ? (
                  <Callout
                    tone="warning"
                    title="Todavía no armaste ninguna lista"
                    action={
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`/${tenantSlug}/mensajeria/audiencias/nueva`}>
                          <Users aria-hidden />
                          Armar una audiencia
                        </Link>
                      </Button>
                    }
                  >
                    Las listas se arman en Audiencias. Después volvé acá y elegila.
                  </Callout>
                ) : (
                  <Field
                    label="Lista de destinatarios"
                    labelHidden
                    hint={
                      audienceCount
                        ? `Hoy son ${audienceCount}. Los que no aceptaron recibir promos quedan afuera solos.`
                        : undefined
                    }
                  >
                    <Select value={audienceId} onValueChange={setAudienceId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí una lista" />
                      </SelectTrigger>
                      <SelectContent>
                        {audiences.map((a) => (
                          <SelectItem
                            key={a.id}
                            value={a.id}
                            description={clientesLabel(a.customer_count_cached)}
                          >
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </FormSection>
            ) : null}

            {step === 4 ? (
              <FormSection
                title="Nombre y fecha"
                description="Un nombre para reconocerla después (los clientes no lo ven) y cuándo sale."
              >
                {events.length > 0 ? (
                  <Field
                    label="¿Es para anunciar un evento?"
                    optional
                    hint="Al elegirlo, el nombre de la difusión se completa solo."
                  >
                    <Select
                      value={eventId}
                      onValueChange={(v) => {
                        setEventId(v)
                        const ev = events.find((e) => e.id === v)
                        if (ev) setName(`${ev.name} · ${eventShortDate(ev.date)}`)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí un evento del calendario…" />
                      </SelectTrigger>
                      <SelectContent>
                        {events.map((e) => (
                          <SelectItem
                            key={e.id}
                            value={e.id}
                            description={`${eventShortDate(e.date)} · ${e.time}`}
                          >
                            {e.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                <Field label="Nombre" hint="Solo para vos: los clientes no lo ven.">
                  <Input
                    placeholder="Ej: Septiembre · peña folklórica"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    required
                  />
                </Field>
                <div className="flex flex-col gap-2">
                  <p id="broadcast-when-label" className="type-label text-foreground">
                    ¿Cuándo sale?
                  </p>
                  <SegmentedControl
                    aria-labelledby="broadcast-when-label"
                    aria-label="Cuándo sale"
                    items={SEND_MODE_ITEMS}
                    value={sendMode}
                    onValueChange={setSendMode}
                  />
                </div>
                {sendMode === 'later' ? (
                  <Field
                    label="Día y hora"
                    hint={
                      whenText
                        ? `Sale el ${whenText} (hora de Córdoba).`
                        : 'Elegí el día y la hora para poder seguir.'
                    }
                  >
                    <DateTimeField
                      value={scheduledLocal}
                      onValueChange={setScheduledLocal}
                      minDate={todayInCordoba()}
                    />
                  </Field>
                ) : (
                  <p className="type-small text-muted-foreground">
                    Se envía apenas confirmes en el último paso.
                  </p>
                )}
              </FormSection>
            ) : null}

            {step === 5 ? (
              <FormSection
                title="Último vistazo"
                description="Revisá que esté todo bien antes de confirmar."
              >
                <Callout tone="success" icon={Send}>
                  <p className="text-foreground">
                    Se lo vas a mandar a <strong>{audienceCount ?? 'los clientes'}</strong> de la
                    lista «{audience?.name ?? '—'}»,{' '}
                    {whenText ? `el ${whenText}` : 'ahora mismo, ni bien confirmes'}.
                  </p>
                  <p className="mt-1">
                    Solo les llega a los que aceptaron recibir promos. Los que pidieron no recibir
                    más quedan afuera solos.
                  </p>
                </Callout>

                <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  <SummaryRow
                    icon={Megaphone}
                    label="Canal"
                    value={
                      channel ? (channel.display_name ?? CHANNEL_TYPE_LABEL[channel.type]) : '—'
                    }
                  />
                  <SummaryRow
                    icon={Sparkles}
                    label="Mensaje"
                    value={
                      template
                        ? `${humanizeTemplateName(template.name)} · ${languageLabel(template.language)}`
                        : '—'
                    }
                  />
                  <SummaryRow
                    icon={Users}
                    label="Destinatarios"
                    value={audience ? `${audience.name} · ${audienceCount}` : '—'}
                  />
                  <SummaryRow
                    icon={Calendar}
                    label="Cuándo"
                    value={whenText ? `El ${whenText}` : 'Ahora mismo'}
                  />
                </dl>

                {bubblePreview}
              </FormSection>
            ) : null}
          </div>
        </Card>

        <FormActions sticky={false} align="between">
          <Button
            type="button"
            variant="secondary"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            <ArrowLeft aria-hidden />
            Atrás
          </Button>
          {/* Claves distintas: React nunca reusa el mismo <button> pasándolo de
              «Siguiente» a «Enviar» en medio del click (enviaría el formulario). */}
          {step < maxStep ? (
            <Button
              key="next"
              type="button"
              disabled={!canNext}
              onClick={() => setStep((s) => Math.min(maxStep, s + 1))}
            >
              Siguiente
              <ArrowRight aria-hidden />
            </Button>
          ) : (
            <SubmitButton key="submit" pendingText={scheduledAt ? 'Programando…' : 'Enviando…'}>
              <Send aria-hidden />
              {scheduledAt ? 'Programar envío' : 'Enviar ahora'}
            </SubmitButton>
          )}
        </FormActions>
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
  const [state, action] = useActionState(sendBroadcastTest.bind(null, tenantSlug), {
    ok: true,
  } as BroadcastActionState)
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message)
    else if (!state.ok && state.message) toast.error(state.message)
  }, [state])
  if (!channelId || !templateId) return null
  return (
    <Section
      divider
      headingLevel={3}
      title="Probalo primero en tu WhatsApp"
      description="Te mandás el mensaje a vos y lo ves tal cual le llega al cliente. No le llega a nadie más."
    >
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="channel_id" value={channelId} />
        <input type="hidden" name="template_id" value={templateId} />
        <input type="hidden" name="variable_mapping" value={JSON.stringify(mapping)} />
        <Field label="Tu número" className="flex-1">
          <Input
            name="to_phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="Ej: 351 555-1234"
          />
        </Field>
        <SubmitButton variant="secondary" pendingText="Enviando…">
          <Send aria-hidden />
          Mandar prueba
        </SubmitButton>
      </form>
    </Section>
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
    <div className="flex items-start gap-3 px-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <dt className="type-label text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words type-body font-medium text-foreground">{value}</dd>
      </div>
    </div>
  )
}
