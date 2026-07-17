'use client'

import { PlusIcon } from 'lucide-react'
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

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidad',
  AUTHENTICATION: 'Autenticación',
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
      toast.success(state.message)
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
            Completá los campos y enviá a revisión de Meta. Aparecerá como{' '}
            <strong>Pendiente</strong> hasta que la aprueben (suele tardar de minutos a 24 h).
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
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tmpl-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                placeholder="ej. bienvenida_nuevo_cliente"
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">
                Solo minúsculas, números y guiones bajos. Sin espacios.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="tmpl-category">
                  Categoría <span className="text-destructive">*</span>
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
                <Input
                  id="tmpl-language"
                  name="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="ej. es_AR, en_US"
                />
              </div>
            </div>

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
              <p className="text-muted-foreground text-xs">
                Usá <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>… para personalizar. La difusión
                completa cada variable por cada cliente.
              </p>
            </div>

            {bodyVars.length > 0 ? (
              <div className="grid gap-2 rounded-lg border border-border/60 bg-secondary/20 p-3">
                <p className="text-xs font-medium">Ejemplos de las variables</p>
                <p className="text-[11px] text-muted-foreground">
                  Meta pide un ejemplo por variable para poder aprobar la plantilla.
                </p>
                {bodyVars.map((n) => (
                  <div key={n} className="flex items-center gap-2">
                    <code className="w-8 shrink-0 text-xs text-muted-foreground">{`{{${n}}}`}</code>
                    <Input
                      value={bodyExamples[n - 1] ?? ''}
                      onChange={(e) => setExampleAt(n, e.target.value)}
                      placeholder={`Ejemplo para {{${n}}}`}
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
            </div>

            <div className="grid gap-2 rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="tmpl-optout"
                  checked={optOut}
                  onCheckedChange={(v) => setOptOut(v === true)}
                />
                <Label htmlFor="tmpl-optout" className="font-normal">
                  Botón para darse de baja{' '}
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
                />
              ) : null}
              <div className="mt-1 grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Botón de enlace (opcional)</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    name="urlButtonText"
                    value={urlText}
                    onChange={(e) => setUrlText(e.target.value)}
                    placeholder="Texto (ej. Ver menú)"
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
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Vista previa</p>
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
              {pending ? 'Enviando a Meta…' : 'Enviar a revisión'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
