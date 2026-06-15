'use client'

import { ExternalLink, Loader2, MessageCircle, Send } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { type ContactTemplateItem, contactCustomer, getContactTemplates } from '@/lib/meta/contact'
import { buildWaMeUrl, formatPhoneForDisplay } from '@/lib/phone'

type Mode = 'message' | 'template'

export interface ContactCustomerSheetProps {
  tenantSlug: string
  customerId?: string
  phone: string
  name?: string
  trigger?: ReactNode
}

export function ContactCustomerSheet({
  tenantSlug,
  customerId,
  phone,
  name,
  trigger,
}: ContactCustomerSheetProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('message')
  const [body, setBody] = useState('')
  const [isPending, startTransition] = useTransition()

  // Template mode state
  const [templates, setTemplates] = useState<ContactTemplateItem[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [templateVars, setTemplateVars] = useState<string[]>([])
  const templatesLoaded = useRef(false)

  const displayPhone = formatPhoneForDisplay(phone)
  const waMeUrl = buildWaMeUrl(phone, body.trim() || undefined)

  const title = name ? `Contactar a ${name}` : 'Contactar cliente'

  function resetState() {
    setMode('message')
    setBody('')
    setSelectedTemplateId('')
    setTemplateVars([])
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) resetState()
  }

  const loadTemplates = useCallback(async () => {
    if (templatesLoaded.current) return
    setTemplatesLoading(true)
    try {
      const data = await getContactTemplates(tenantSlug)
      setTemplates(data)
      templatesLoaded.current = true
    } catch {
      toast.error('No se pudieron cargar las plantillas.')
    } finally {
      setTemplatesLoading(false)
    }
  }, [tenantSlug])

  useEffect(() => {
    if (mode === 'template') {
      void loadTemplates()
    }
  }, [mode, loadTemplates])

  function switchToTemplate() {
    setMode('template')
  }

  // How many {{n}} params does the selected template body have?
  // We infer variable count from the template name heuristic (0 for now)
  // but expose up to 5 variable inputs when the user selects a template.
  // The backend accepts whatever variables[] array we send.
  const VARIABLE_SLOTS = 5

  function handleSendMessage() {
    if (!body.trim()) return
    startTransition(async () => {
      const result = await contactCustomer(tenantSlug, {
        customer_id: customerId,
        phone: customerId ? undefined : phone,
        body: body.trim(),
      })

      if (result.ok) {
        toast.success('Mensaje enviado', {
          description: (
            <Link
              href={`/${tenantSlug}/bandeja?c=${result.conversationId}`}
              className="underline underline-offset-2"
            >
              Ver conversación →
            </Link>
          ),
        })
        setOpen(false)
        return
      }

      if (result.code === 'window_closed') {
        toast.info('Ventana de 24 hs cerrada', {
          description: 'El cliente no te escribió recientemente. Enviá una plantilla.',
        })
        switchToTemplate()
        return
      }

      if (result.code === 'no_channel') {
        toast.warning('Sin canal de WhatsApp conectado', {
          description: 'Usá el enlace wa.me para contactar directamente.',
        })
        return
      }

      toast.error(result.message ?? 'Error al enviar el mensaje.')
    })
  }

  function handleSendTemplate() {
    const tpl = templates.find((t) => t.id === selectedTemplateId)
    if (!tpl) return
    const vars = templateVars.filter((v) => v.trim() !== '')
    startTransition(async () => {
      const result = await contactCustomer(tenantSlug, {
        customer_id: customerId,
        phone: customerId ? undefined : phone,
        template: { name: tpl.name, language: tpl.language, variables: vars },
      })

      if (result.ok) {
        toast.success('Plantilla enviada', {
          description: (
            <Link
              href={`/${tenantSlug}/bandeja?c=${result.conversationId}`}
              className="underline underline-offset-2"
            >
              Ver conversación →
            </Link>
          ),
        })
        setOpen(false)
        return
      }

      toast.error(result.message ?? 'Error al enviar la plantilla.')
    })
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <MessageCircle className="size-4" aria-hidden />
            Contactar
          </Button>
        )}
      </SheetTrigger>

      <SheetContent side="right" className="flex flex-col gap-0 sm:max-w-sm">
        <SheetHeader className="border-b pb-4">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{displayPhone}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* Mode tabs */}
          <div className="flex gap-1 rounded-lg border p-1">
            <button
              type="button"
              onClick={() => setMode('message')}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === 'message'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={mode === 'message'}
            >
              Mensaje
            </button>
            <button
              type="button"
              onClick={() => setMode('template')}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === 'template'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={mode === 'template'}
            >
              Plantilla
            </button>
          </div>

          {mode === 'message' ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="contact-body">Mensaje</Label>
                <Textarea
                  id="contact-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Escribí tu mensaje…"
                  rows={5}
                  maxLength={4096}
                  className="resize-none"
                  aria-describedby="contact-body-hint"
                />
                <p id="contact-body-hint" className="text-[11px] text-muted-foreground">
                  Solo disponible dentro de la ventana de 24 hs desde el último mensaje del cliente.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {templatesLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Cargando plantillas…
                </div>
              ) : templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay plantillas aprobadas. Creá una en{' '}
                  <Link
                    href={`/${tenantSlug}/configuracion`}
                    className="underline underline-offset-2"
                  >
                    Configuración
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="contact-template">Plantilla</Label>
                    <Select
                      value={selectedTemplateId}
                      onValueChange={(v) => {
                        setSelectedTemplateId(v)
                        setTemplateVars([])
                      }}
                    >
                      <SelectTrigger id="contact-template" className="w-full">
                        <SelectValue placeholder="Seleccioná una plantilla…" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                            <span className="ml-1 text-[10px] text-muted-foreground uppercase">
                              {t.language}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedTemplateId ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-muted-foreground">
                        Variables de la plantilla (dejá vacío lo que no aplique):
                      </p>
                      {Array.from({ length: VARIABLE_SLOTS }, (_, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: lista de slots fija, sin reordenamiento
                        <div key={`var-${i}`} className="flex flex-col gap-1">
                          <Label htmlFor={`tvar-${i}`} className="text-xs">
                            {'{{'}
                            {i + 1}
                            {'}}'}
                          </Label>
                          <input
                            id={`tvar-${i}`}
                            type="text"
                            value={templateVars[i] ?? ''}
                            onChange={(e) => {
                              const next = [...templateVars]
                              next[i] = e.target.value
                              setTemplateVars(next)
                            }}
                            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 flex h-8 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
                            placeholder={`Variable ${i + 1}`}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="border-t">
          <div className="flex w-full flex-col gap-2">
            {mode === 'message' ? (
              <Button
                onClick={handleSendMessage}
                disabled={!body.trim() || isPending}
                className="w-full"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
                Enviar mensaje
              </Button>
            ) : (
              <Button
                onClick={handleSendTemplate}
                disabled={!selectedTemplateId || isPending}
                className="w-full"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
                Enviar plantilla
              </Button>
            )}

            {waMeUrl ? (
              <Button asChild variant="outline" size="sm" className="w-full">
                <a href={waMeUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" aria-hidden />
                  Abrir en WhatsApp
                </a>
              </Button>
            ) : null}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
