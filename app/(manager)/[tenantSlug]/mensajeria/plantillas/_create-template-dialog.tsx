'use client'

import { LightbulbIcon, PlusIcon } from 'lucide-react'
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { WhatsAppBubble } from '@/components/messaging/whatsapp-bubble'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldRow, FormError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
import {
  TEMPLATE_VARIABLES,
  type VariableSourceKey,
  variableDefinition,
} from '@/lib/broadcasts/variables'
import type { MetaActionState } from '@/lib/meta/actions'
import { createTemplateAction } from '@/lib/meta/template-actions'
import {
  caretOutsideVariable,
  extractPositionalVars,
  fillExamples,
  renumberPositionalVars,
} from '@/lib/meta/template-components'
import { TEMPLATE_CATEGORIES } from '@/lib/meta/template-schemas'
import { CATEGORY_LABELS } from './_template-display'

// El value es el código que exige Meta; el label es lo que ve el dueño.
const LANGUAGE_OPTIONS = [
  { code: 'es_AR', label: 'Español (Argentina)' },
  { code: 'es_MX', label: 'Español (México)' },
  { code: 'es_ES', label: 'Español (España)' },
  { code: 'es', label: 'Español (neutro)' },
  { code: 'en_US', label: 'Inglés (EE. UU.)' },
  { code: 'pt_BR', label: 'Portugués (Brasil)' },
] as const

const CATEGORY_HELP: Record<string, string> = {
  MARKETING:
    'Promoción: descuentos, eventos y novedades. Necesita que el cliente acepte recibir promos.',
  UTILITY: 'Aviso: confirmaciones y recordatorios puntuales (reservas, pedidos).',
  AUTHENTICATION: 'Verificación: solo para mandar códigos de acceso.',
}

const initial: MetaActionState = { ok: true }

export function CreateTemplateDialog({
  tenantSlug,
  channelId,
}: {
  tenantSlug: string
  channelId: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('MARKETING')
  const [language, setLanguage] = useState('es_AR')
  const [headerText, setHeaderText] = useState('')
  const [headerExample, setHeaderExample] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [bodyExamples, setBodyExamples] = useState<string[]>([])
  /** Qué dato del cliente representa cada hueco: `{"1": "first_name"}`. */
  const [variableHints, setVariableHints] = useState<Record<string, VariableSourceKey>>({})
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [footerText, setFooterText] = useState('')
  const [optOut, setOptOut] = useState(true)
  const [optOutLabel, setOptOutLabel] = useState('No recibir promociones')
  const [urlText, setUrlText] = useState('')
  const [urlUrl, setUrlUrl] = useState('')

  const boundAction = createTemplateAction.bind(null, tenantSlug)
  const [state, action] = useActionState(boundAction, initial)

  const bodyVars = useMemo(() => extractPositionalVars(bodyText), [bodyText])
  const headerVars = useMemo(() => extractPositionalVars(headerText), [headerText])

  const reset = useCallback(() => {
    setName('')
    setCategory('MARKETING')
    setLanguage('es_AR')
    setHeaderText('')
    setHeaderExample('')
    setBodyText('')
    setBodyExamples([])
    setVariableHints({})
    setFooterText('')
    setOptOut(true)
    setOptOutLabel('No recibir promociones')
    setUrlText('')
    setUrlUrl('')
  }, [])

  useEffect(() => {
    if (state.ok && state.message) {
      // El server devuelve el estado crudo de Meta; acá lo traducimos a criollo.
      toast.success(
        state.message.includes('APPROVED')
          ? 'La plantilla ya está aprobada. Podés usarla ahora mismo.'
          : 'Listo, quedó en revisión. WhatsApp suele aprobarla entre unos minutos y 24 horas.',
      )
      setOpen(false)
      reset()
    }
    // El error queda adentro del diálogo (FormError), no en un aviso que se va.
  }, [state, reset])

  // Ejemplos en el orden de las variables del cuerpo (1..n).
  const orderedBodyExamples = bodyVars.map((n) => bodyExamples[n - 1] ?? '')

  function setExampleAt(varNum: number, value: string) {
    setBodyExamples((prev) => {
      const next = [...prev]
      while (next.length < varNum) next.push('')
      next[varNum - 1] = value
      return next
    })
  }

  /**
   * Escribe el cuerpo renumerando siempre las variables a 1..n en orden de
   * aparición. Así borrar un `{{1}}` del medio no deja `{{2}} {{3}}`, que Meta
   * rechaza por una regla que el dueño no tiene por qué conocer.
   */
  function changeBody(next: string) {
    const fixed = renumberPositionalVars(next, {
      examples: bodyExamples,
      hints: variableHints,
    })
    setBodyText(fixed.text)
    setBodyExamples(fixed.examples)
    setVariableHints(fixed.hints as Record<string, VariableSourceKey>)
  }

  /** Inserta el dato donde está el cursor y deja el ejemplo ya cargado. */
  function insertVariable(source: VariableSourceKey) {
    const el = bodyRef.current
    const raw = el ? (el.selectionStart ?? bodyText.length) : bodyText.length
    const position = caretOutsideVariable(bodyText, raw)
    const next = bodyVars.length + 1
    const token = `{{${next}}}`
    const merged = `${bodyText.slice(0, position)}${token}${bodyText.slice(position)}`

    const fixed = renumberPositionalVars(merged, {
      examples: bodyExamples,
      hints: variableHints,
    })
    // El hueco recién puesto es el que quedó en la posición del cursor.
    const insertedAt = (merged.slice(0, position).match(/\{\{\s*\d+\s*\}\}/g) ?? []).length + 1
    const definition = variableDefinition(source)
    const examples = [...fixed.examples]
    if (!examples[insertedAt - 1]?.trim()) {
      examples[insertedAt - 1] = definition?.example ?? ''
    }

    setBodyText(fixed.text)
    setBodyExamples(examples)
    setVariableHints({
      ...(fixed.hints as Record<string, VariableSourceKey>),
      [String(insertedAt)]: source,
    })

    // Dejar el cursor después del hueco para poder seguir escribiendo.
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const caret = position + token.length
      el.setSelectionRange(caret, caret)
    })
  }

  /** Cambia qué dato representa un hueco; si el ejemplo seguía siendo el que
   *  pusimos por default, lo actualizamos para que no quede desfasado. */
  function changeHint(position: number, source: VariableSourceKey) {
    const previous = variableHints[String(position)]
    const previousExample = previous ? variableDefinition(previous)?.example : undefined
    const current = bodyExamples[position - 1] ?? ''

    setVariableHints((prev) => ({ ...prev, [String(position)]: source }))
    if (!current.trim() || current === previousExample) {
      setExampleAt(position, variableDefinition(source)?.example ?? '')
    }
  }

  const previewButtons = [
    ...(urlText.trim() ? [{ id: 'url', text: urlText.trim() }] : []),
    ...(optOut && optOutLabel.trim() ? [{ id: 'optout', text: optOutLabel.trim() }] : []),
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon aria-hidden />
          Nueva plantilla
        </Button>
      </DialogTrigger>

      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Nueva plantilla de WhatsApp</DialogTitle>
          <DialogDescription>
            WhatsApp revisa cada plantilla antes de dejarte usarla. Escribí el mensaje, mandalo a
            revisión y suele estar aprobado entre unos minutos y 24 horas.
          </DialogDescription>
        </DialogHeader>

        {/* El formulario abraza cuerpo y pie: el cuerpo scrollea y «Mandar a
            revisión» queda siempre a la vista. */}
        <form action={action} className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Campos serializados que no son inputs de texto simples */}
          <input type="hidden" name="channel_id" value={channelId} />
          <input type="hidden" name="bodyExamples" value={JSON.stringify(orderedBodyExamples)} />
          <input type="hidden" name="variableHints" value={JSON.stringify(variableHints)} />
          <input type="hidden" name="optOut" value={optOut ? 'true' : 'false'} />

          <DialogBody>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_14rem]">
              {/* Columna izquierda: formulario */}
              <div className="grid content-start gap-4">
                <FormError
                  title="WhatsApp no recibió la plantilla"
                  message={state.ok ? null : state.message}
                />

                <Field
                  label="Nombre técnico"
                  hint="Tus clientes nunca lo ven. WhatsApp lo exige único, en minúsculas y con guion bajo (_) en vez de espacios."
                >
                  <Input
                    name="name"
                    value={name}
                    onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                    placeholder="ej. bienvenida_nuevo_cliente"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </Field>

                <FieldRow>
                  <Field label="¿Para qué es?">
                    <Select name="category" value={category} onValueChange={setCategory}>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí…" />
                      </SelectTrigger>
                      <SelectContent>
                        {TEMPLATE_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {CATEGORY_LABELS[cat] ?? cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Idioma">
                    <Select name="language" value={language} onValueChange={setLanguage}>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí…" />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGE_OPTIONS.map((lang) => (
                          <SelectItem key={lang.code} value={lang.code}>
                            {lang.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldRow>
                {CATEGORY_HELP[category] ? (
                  <p className="-mt-2 type-caption text-subtle-foreground">
                    {CATEGORY_HELP[category]}
                  </p>
                ) : null}

                <Field label="Encabezado" optional hint="Una línea en negrita arriba del mensaje.">
                  <Input
                    name="headerText"
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    placeholder="ej. Novedades de HUB"
                    maxLength={60}
                  />
                </Field>
                {headerVars.length > 0 ? (
                  <Field
                    label="Ejemplo del dato del encabezado"
                    hint="Lo ve WhatsApp para aprobarla; no se le manda a nadie."
                  >
                    <Input
                      size="sm"
                      name="headerExample"
                      value={headerExample}
                      onChange={(e) => setHeaderExample(e.target.value)}
                      placeholder="ej. Juan"
                    />
                  </Field>
                ) : null}

                <Field label="Cuerpo del mensaje">
                  <Textarea
                    name="bodyText"
                    ref={bodyRef}
                    value={bodyText}
                    onChange={(e) => changeBody(e.target.value)}
                    placeholder="ej. ¡Hola {{1}}! Te esperamos con un beneficio especial."
                    maxLength={1024}
                    showCount
                    className="min-h-24"
                  />
                </Field>

                {/* Los datos del cliente, como botones. Se insertan donde está el
                    cursor: el dueño escribe "¡Hola " y toca Nombre. */}
                <fieldset className="-mt-1 flex min-w-0 flex-col gap-2">
                  <legend className="mb-2 type-caption text-muted-foreground">
                    <span className="font-medium text-foreground">Insertá un dato del cliente</span>{' '}
                    — se completa solo en cada mensaje
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {TEMPLATE_VARIABLES.map((v) => (
                      <Button
                        key={v.key}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="rounded-full"
                        title={v.hint}
                        onClick={() => insertVariable(v.key)}
                      >
                        <PlusIcon aria-hidden />
                        {v.label}
                      </Button>
                    ))}
                  </div>
                </fieldset>

                {bodyVars.length > 0 ? (
                  <Callout tone="neutral" icon={LightbulbIcon} title="Qué va en cada hueco">
                    <p>
                      Cada hueco se completa con el dato de ese cliente. El ejemplo es lo que ve
                      WhatsApp para aprobar el mensaje: no se le manda a nadie.
                    </p>
                    <div className="mt-3 flex flex-col gap-2">
                      {bodyVars.map((n) => {
                        const hint = variableHints[String(n)] ?? 'custom'
                        return (
                          <div key={n} className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-card font-mono type-caption font-semibold tabular-nums text-foreground"
                            >
                              {n}
                            </span>
                            <Select
                              value={hint}
                              onValueChange={(v) => changeHint(n, v as VariableSourceKey)}
                            >
                              <SelectTrigger
                                size="sm"
                                className="w-36 shrink-0"
                                aria-label={`Qué dato va en el hueco ${n}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TEMPLATE_VARIABLES.map((v) => (
                                  <SelectItem key={v.key} value={v.key}>
                                    {v.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              size="sm"
                              value={bodyExamples[n - 1] ?? ''}
                              onChange={(e) => setExampleAt(n, e.target.value)}
                              placeholder={`ej. ${variableDefinition(hint)?.example ?? 'Juan'}`}
                              aria-label={`Ejemplo del hueco ${n}`}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </Callout>
                ) : null}

                <Field
                  label="Pie"
                  optional
                  hint="Texto chiquito al final. Ideal para la firma del bar."
                >
                  <Input
                    name="footerText"
                    value={footerText}
                    onChange={(e) => setFooterText(e.target.value)}
                    placeholder="ej. HUB · Córdoba"
                    maxLength={60}
                  />
                </Field>

                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  <Field
                    layout="toggle"
                    label="Botón para dejar de recibir promos"
                    hint="Recomendado: el cliente se da de baja solo y no te marca el número como spam."
                  >
                    <Switch checked={optOut} onCheckedChange={(v) => setOptOut(v === true)} />
                  </Field>
                  {optOut ? (
                    <Field label="Texto del botón">
                      <Input
                        size="sm"
                        name="optOutLabel"
                        value={optOutLabel}
                        onChange={(e) => setOptOutLabel(e.target.value)}
                        maxLength={25}
                      />
                    </Field>
                  ) : null}
                  <FieldRow>
                    <Field label="Botón que abre un enlace" optional>
                      <Input
                        size="sm"
                        name="urlButtonText"
                        value={urlText}
                        onChange={(e) => setUrlText(e.target.value)}
                        placeholder="Texto (ej. Ver la carta)"
                        maxLength={25}
                      />
                    </Field>
                    <Field label="Enlace del botón" optional>
                      <Input
                        size="sm"
                        inputMode="url"
                        autoCapitalize="none"
                        spellCheck={false}
                        name="urlButtonUrl"
                        value={urlUrl}
                        onChange={(e) => setUrlUrl(e.target.value)}
                        placeholder="https://…"
                      />
                    </Field>
                  </FieldRow>
                </div>
              </div>

              {/* Columna derecha: vista previa */}
              <div className="md:sticky md:top-0 md:self-start">
                <p className="mb-2 type-label text-foreground">Así lo va a ver el cliente</p>
                <WhatsAppBubble
                  header={headerText ? fillExamples(headerText, [headerExample]) : ''}
                  body={fillExamples(bodyText, bodyExamples)}
                  footer={footerText}
                  buttons={previewButtons}
                />
              </div>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton
              pendingText="Mandando a WhatsApp…"
              disabled={!name.trim() || !bodyText.trim()}
            >
              Mandar a revisión
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
