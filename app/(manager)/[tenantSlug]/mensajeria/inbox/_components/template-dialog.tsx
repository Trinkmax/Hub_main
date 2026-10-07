'use client'

import { ArrowLeft, ChevronRight, Send } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { WhatsAppBubble } from '@/components/messaging/whatsapp-bubble'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, SearchField } from '@/components/ui/input'
import {
  countBodyVariables,
  fillTemplateBody,
  getTemplateBodyText,
  humanizeTemplateName,
  TEMPLATE_CATEGORY_LABEL,
  type TemplateLite,
} from '@/lib/bandeja/template-view'
import { sendTemplateMessage } from '@/lib/meta/actions'
import { waActionClass } from '../../_components/wa-classes'

/**
 * Diálogo para mandar un "mensaje aprobado" (plantilla de WhatsApp) con
 * vista previa en vivo. Pensado para dueños no técnicos: nada de jerga.
 */
export function TemplateDialog({
  tenantSlug,
  conversationId,
  templates,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  conversationId: string
  templates: TemplateLite[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<TemplateLite | null>(null)
  const [variables, setVariables] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templates
    return templates.filter((t) => {
      const body = getTemplateBodyText(t.components) ?? ''
      return t.name.toLowerCase().includes(q) || body.toLowerCase().includes(q)
    })
  }, [templates, query])

  const bodyText = selected ? getTemplateBodyText(selected.components) : null
  const variableCount = selected ? countBodyVariables(selected.components) : 0
  const previewBody = bodyText ? fillTemplateBody(bodyText, variables) : ''
  const missingVars =
    variables.slice(0, variableCount).filter((v) => v && v.trim() !== '').length < variableCount

  function reset() {
    setSelected(null)
    setVariables([])
    setQuery('')
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) reset()
  }

  function handleSend() {
    if (!selected) return
    const fd = new FormData()
    fd.set('conversation_id', conversationId)
    fd.set('template_name', selected.name)
    fd.set('template_language', selected.language)
    for (let i = 0; i < variableCount; i++) {
      fd.append('variable', variables[i] ?? '')
    }
    startTransition(async () => {
      const result = await sendTemplateMessage(tenantSlug, { ok: true }, fd)
      if (result.ok) {
        toast.success('Mensaje aprobado enviado')
        handleOpenChange(false)
      } else {
        toast.error(result.message ?? 'No se pudo enviar.')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm" className="wa">
        <DialogHeader>
          {/* «Volver» afuera del título, así no se cuela en el nombre del diálogo. */}
          <div className="flex items-center gap-2">
            {selected ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="-ml-1.5 shrink-0"
                onClick={() => {
                  setSelected(null)
                  setVariables([])
                }}
                aria-label="Volver a la lista de mensajes"
              >
                <ArrowLeft aria-hidden />
              </Button>
            ) : null}
            <DialogTitle className="min-w-0 truncate">
              {selected ? humanizeTemplateName(selected.name) : 'Mensajes aprobados'}
            </DialogTitle>
          </div>
          <DialogDescription>
            {selected
              ? 'Completá los datos y mirá cómo lo va a recibir el cliente.'
              : 'Son mensajes que WhatsApp ya aprobó: sirven para escribirle al cliente aunque hayan pasado más de 24 horas.'}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <>
            {templates.length > 5 ? (
              <SearchField
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClear={() => setQuery('')}
                placeholder="Buscar mensaje…"
                aria-label="Buscar mensaje aprobado"
              />
            ) : null}
            <DialogBody>
              {filtered.length === 0 ? (
                <p className="px-3 py-8 text-center type-body text-muted-foreground">
                  {templates.length === 0
                    ? 'Todavía no tenés mensajes aprobados por WhatsApp. Se crean en Mensajería, en Plantillas.'
                    : 'No encontramos mensajes con ese texto. Probá con otra palabra.'}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {filtered.map((t) => {
                    const body = getTemplateBodyText(t.components)
                    const category = TEMPLATE_CATEGORY_LABEL[t.category.toUpperCase()] ?? null
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(t)}
                          className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left outline-(--ring) -outline-offset-2 hover:bg-hover focus-visible:outline-2"
                        >
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="type-body font-medium text-foreground">
                                {humanizeTemplateName(t.name)}
                              </span>
                              {category ? <Badge>{category}</Badge> : null}
                            </span>
                            {body ? (
                              <span className="line-clamp-2 type-small text-muted-foreground">
                                {body}
                              </span>
                            ) : null}
                          </span>
                          <ChevronRight
                            className="size-4 shrink-0 text-subtle-foreground"
                            aria-hidden
                          />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </DialogBody>
          </>
        ) : (
          <>
            <DialogBody className="flex flex-col gap-4">
              <WhatsAppBubble body={previewBody} />
              {variableCount > 0 ? (
                <div className="flex flex-col gap-3">
                  <p className="type-label text-foreground">
                    Completá {variableCount === 1 ? 'el dato' : 'los datos'} del mensaje
                  </p>
                  {Array.from({ length: variableCount }).map((_, i) => (
                    <Field
                      // biome-ignore lint/suspicious/noArrayIndexKey: el orden es estable por contrato del template Meta ({{1}}, {{2}}…)
                      key={`${selected.id}-${i}`}
                      label={variableCount === 1 ? 'Dato' : `Dato ${i + 1}`}
                      labelHidden={variableCount === 1}
                    >
                      <Input
                        value={variables[i] ?? ''}
                        onChange={(e) => {
                          const next = [...variables]
                          next[i] = e.target.value
                          setVariables(next)
                        }}
                        placeholder="Ej: el nombre, una fecha…"
                        required
                      />
                    </Field>
                  ))}
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                onClick={handleSend}
                disabled={missingVars}
                loading={isPending}
                loadingText="Enviando…"
                className={waActionClass}
              >
                <Send aria-hidden />
                Enviar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
