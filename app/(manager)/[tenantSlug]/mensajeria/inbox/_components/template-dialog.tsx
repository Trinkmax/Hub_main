'use client'

import { ArrowLeft, Loader2, Search, Send } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { WhatsAppBubble } from '@/components/messaging/whatsapp-bubble'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  countBodyVariables,
  fillTemplateBody,
  getTemplateBodyText,
  humanizeTemplateName,
  TEMPLATE_CATEGORY_LABEL,
  type TemplateLite,
} from '@/lib/bandeja/template-view'
import { sendTemplateMessage } from '@/lib/meta/actions'

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
      <DialogContent className="wa max-h-[85dvh] gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            {selected ? (
              <button
                type="button"
                onClick={() => {
                  setSelected(null)
                  setVariables([])
                }}
                aria-label="Volver a la lista"
                className="-ml-1 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <ArrowLeft className="size-4" aria-hidden />
              </button>
            ) : null}
            {selected ? humanizeTemplateName(selected.name) : 'Mensajes aprobados'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {selected
              ? 'Completá los datos y mirá cómo lo va a recibir el cliente.'
              : 'Son mensajes que WhatsApp ya aprobó: sirven para escribirle al cliente aunque hayan pasado más de 24 horas.'}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="flex max-h-[60dvh] flex-col">
            {templates.length > 5 ? (
              <div className="relative border-b px-4 py-2">
                <Search className="pointer-events-none absolute left-7 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar mensaje…"
                  className="h-9 pl-9"
                />
              </div>
            ) : null}
            <div className="overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {templates.length === 0
                    ? 'Todavía no tenés mensajes aprobados por WhatsApp.'
                    : 'No encontramos mensajes con ese texto.'}
                </p>
              ) : (
                filtered.map((t) => {
                  const body = getTemplateBodyText(t.components)
                  const category = TEMPLATE_CATEGORY_LABEL[t.category.toUpperCase()] ?? null
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelected(t)}
                      className="flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium">{humanizeTemplateName(t.name)}</span>
                        {category ? (
                          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                            {category}
                          </span>
                        ) : null}
                      </span>
                      {body ? (
                        <span className="line-clamp-2 text-xs text-muted-foreground">{body}</span>
                      ) : null}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto p-4">
            <WhatsAppBubble body={previewBody} />
            {variableCount > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Completá {variableCount === 1 ? 'el dato' : 'los datos'} del mensaje:
                </p>
                {Array.from({ length: variableCount }).map((_, i) => (
                  <Input
                    // biome-ignore lint/suspicious/noArrayIndexKey: el orden es estable por contrato del template Meta ({{1}}, {{2}}…)
                    key={`${selected.id}-${i}`}
                    value={variables[i] ?? ''}
                    onChange={(e) => {
                      const next = [...variables]
                      next[i] = e.target.value
                      setVariables(next)
                    }}
                    placeholder={`Dato ${i + 1} — ej: nombre, fecha…`}
                    required
                  />
                ))}
              </div>
            ) : null}
            <Button
              onClick={handleSend}
              disabled={isPending || missingVars}
              className="w-full gap-1.5 bg-(--wa-accent) text-white hover:bg-(--wa-accent-deep)"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              {isPending ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
