'use client'

import { LightbulbIcon, PlusIcon } from 'lucide-react'
import { useActionState, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { WhatsAppBubble } from '@/components/messaging/whatsapp-bubble'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { MetaActionState } from '@/lib/meta/actions'
import { createTemplateAction } from '@/lib/meta/template-actions'
import { extractPositionalVars, fillExamples } from '@/lib/meta/template-components'
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
  const [footerText, setFooterText] = useState('')
  const [optOut, setOptOut] = useState(true)
  const [optOutLabel, setOptOutLabel] = useState('No recibir promociones')
  const [urlText, setUrlText] = useState('')
  const [urlUrl, setUrlUrl] = useState('')

  const boundAction = createTemplateAction.bind(null, tenantSlug)
  const [state, action, pending] = useActionState(boundAction, initial)

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
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
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

  function insertVariable() {
    setBodyText((t) => `${t}{{${bodyVars.length + 1}}}`)
  }

  const previewButtons = [
    ...(urlText.trim() ? [{ id: 'url', text: urlText.trim() }] : []),
    ...(optOut && optOutLabel.trim() ? [{ id: 'optout', text: optOutLabel.trim() }] : []),
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <PlusIcon className="size-4" />
          Nueva plantilla
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nueva plantilla de WhatsApp</DialogTitle>
          <DialogDescription>
            WhatsApp revisa cada plantilla antes de dejarte usarla. Escribí el mensaje, mandalo a
            revisión y suele estar aprobado entre unos minutos y 24 horas.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-5 md:grid-cols-[1fr_15rem]">
          {/* Campos serializados que no son inputs de texto simples */}
          <input type="hidden" name="channel_id" value={channelId} />
          <input type="hidden" name="bodyExamples" value={JSON.stringify(orderedBodyExamples)} />
          <input type="hidden" name="optOut" value={optOut ? 'true' : 'false'} />

          {/* Columna izquierda: formulario */}
          <div className="grid content-start gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="tmpl-name">
                Nombre técnico <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tmpl-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                placeholder="ej. bienvenida_nuevo_cliente"
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">
                Tus clientes nunca lo ven. WhatsApp lo exige único, en minúsculas y con guión bajo
                (_) en vez de espacios.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="tmpl-category">
                  ¿Para qué es? <span className="text-destructive">*</span>
                </Label>
                <Select name="category" value={category} onValueChange={setCategory}>
                  <SelectTrigger id="tmpl-category" className="w-full">
                    <SelectValue placeholder="Seleccioná…" />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {CATEGORY_LABELS[cat] ?? cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="tmpl-language">
                  Idioma <span className="text-destructive">*</span>
                </Label>
                <Select name="language" value={language} onValueChange={setLanguage}>
                  <SelectTrigger id="tmpl-language" className="w-full">
                    <SelectValue placeholder="Seleccioná…" />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGE_OPTIONS.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {CATEGORY_HELP[category] ? (
              <p className="-mt-2 text-muted-foreground text-xs">{CATEGORY_HELP[category]}</p>
            ) : null}

            <div className="grid gap-1.5">
              <Label htmlFor="tmpl-header">Encabezado (opcional)</Label>
              <Input
                id="tmpl-header"
                name="headerText"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                placeholder="ej. Novedades de HUB"
                maxLength={60}
              />
              <p className="text-muted-foreground text-xs">
                Una línea en negrita arriba del mensaje.
              </p>
              {headerVars.length > 0 ? (
                <Input
                  name="headerExample"
                  value={headerExample}
                  onChange={(e) => setHeaderExample(e.target.value)}
                  placeholder="Ejemplo para la variable del encabezado"
                  className="h-8 text-xs"
                />
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="tmpl-body">
                  Cuerpo del mensaje <span className="text-destructive">*</span>
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={insertVariable}
                >
                  + Insertar variable
                </Button>
              </div>
              <Textarea
                id="tmpl-body"
                name="bodyText"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="ej. ¡Hola {{1}}! Te esperamos con un beneficio especial."
                maxLength={1024}
                className="min-h-24 resize-y"
              />
              <div className="flex gap-2 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2.5">
                <LightbulbIcon
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <p className="text-muted-foreground text-xs">
                  <strong className="text-foreground">¿Qué es {'{{1}}'}?</strong> Un hueco que se
                  completa solo con el dato de cada cliente. Si escribís «¡Hola {'{{1}}'}!», Juan
                  recibe «¡Hola Juan!» y Sofía recibe «¡Hola Sofía!». Tocá «+ Insertar variable»
                  para agregar uno.
                </p>
              </div>
            </div>

            {bodyVars.length > 0 ? (
              <div className="grid gap-2 rounded-lg border border-border/60 bg-secondary/20 p-3">
                <p className="text-xs font-medium">Ejemplos de las variables</p>
                <p className="text-[11px] text-muted-foreground">
                  WhatsApp pide un ejemplo de cada variable para entender el mensaje y aprobarlo. No
                  se le manda a nadie.
                </p>
                {bodyVars.map((n) => (
                  <div key={n} className="flex items-center gap-2">
                    <code className="w-8 shrink-0 text-xs text-muted-foreground">{`{{${n}}}`}</code>
                    <Input
                      value={bodyExamples[n - 1] ?? ''}
                      onChange={(e) => setExampleAt(n, e.target.value)}
                      placeholder={n === 1 ? 'ej. Juan' : `Ejemplo para {{${n}}}`}
                      className="h-8 flex-1 text-xs"
                    />
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <Label htmlFor="tmpl-footer">Pie (opcional)</Label>
              <Input
                id="tmpl-footer"
                name="footerText"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="ej. HUB · Córdoba"
                maxLength={60}
              />
              <p className="text-muted-foreground text-xs">
                Texto chiquito al final. Ideal para la firma del bar.
              </p>
            </div>

            <div className="grid gap-2 rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="tmpl-optout"
                  checked={optOut}
                  onCheckedChange={(v) => setOptOut(v === true)}
                />
                <Label htmlFor="tmpl-optout" className="font-normal">
                  Botón para dejar de recibir promos{' '}
                  <span className="text-muted-foreground">(recomendado)</span>
                </Label>
              </div>
              {optOut ? (
                <Input
                  name="optOutLabel"
                  value={optOutLabel}
                  onChange={(e) => setOptOutLabel(e.target.value)}
                  maxLength={25}
                  className="h-8 text-xs"
                  aria-label="Texto del botón para dejar de recibir promos"
                />
              ) : null}
              <div className="mt-1 grid gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  Botón que abre un enlace (opcional)
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    name="urlButtonText"
                    value={urlText}
                    onChange={(e) => setUrlText(e.target.value)}
                    placeholder="Texto (ej. Ver la carta)"
                    maxLength={25}
                    className="h-8 text-xs"
                  />
                  <Input
                    name="urlButtonUrl"
                    value={urlUrl}
                    onChange={(e) => setUrlUrl(e.target.value)}
                    placeholder="https://…"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Columna derecha: preview */}
          <div className="md:sticky md:top-0 md:self-start">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Así lo va a ver el cliente
            </p>
            <WhatsAppBubble
              header={headerText ? fillExamples(headerText, [headerExample]) : ''}
              body={fillExamples(bodyText, bodyExamples)}
              footer={footerText}
              buttons={previewButtons}
            />
          </div>

          <DialogFooter className="md:col-span-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !name.trim() || !bodyText.trim()}>
              {pending ? 'Mandando a WhatsApp…' : 'Mandar a revisión'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
