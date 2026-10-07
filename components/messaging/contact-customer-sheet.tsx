'use client'

import { ExternalLink, MessageCircle, Send } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { type ContactTemplateItem, contactCustomer, getContactTemplates } from '@/lib/meta/contact'
import { buildWaMeUrl, formatPhoneForDisplay } from '@/lib/phone'

type Mode = 'message' | 'template'

const MODE_ITEMS = [
  { value: 'message' as const, label: 'Mensaje' },
  { value: 'template' as const, label: 'Mensaje aprobado' },
]

export interface ContactCustomerSheetProps {
  tenantSlug: string
  customerId?: string
  phone: string
  name?: string
  trigger?: ReactNode
}

// How many {{n}} params does the selected template body have? The list of
// templates doesn't bring the body, so we expose up to 5 inputs and the
// backend takes whatever variables[] we send (empty ones are dropped).
const VARIABLE_SLOTS = 5

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
      toast.error('No se pudieron cargar los mensajes aprobados. Probá de nuevo.')
    } finally {
      setTemplatesLoading(false)
    }
  }, [tenantSlug])

  useEffect(() => {
    if (mode === 'template') {
      void loadTemplates()
    }
  }, [mode, loadTemplates])

  function conversationLink(conversationId: string) {
    return (
      <Link
        href={`/${tenantSlug}/mensajeria/inbox?c=${conversationId}`}
        className="underline underline-offset-2"
      >
        Ver la conversación
      </Link>
    )
  }

  function handleSendMessage() {
    if (!body.trim()) return
    startTransition(async () => {
      const result = await contactCustomer(tenantSlug, {
        customer_id: customerId,
        phone: customerId ? undefined : phone,
        body: body.trim(),
      })

      if (result.ok) {
        toast.success('Mensaje enviado', { description: conversationLink(result.conversationId) })
        setOpen(false)
        return
      }

      if (result.code === 'window_closed') {
        toast.info('Pasaron más de 24 horas', {
          description:
            'El cliente no te escribió hace poco: para retomar la charla va un mensaje aprobado.',
        })
        setMode('template')
        return
      }

      if (result.code === 'no_channel') {
        toast.warning('No hay un WhatsApp conectado', {
          description: 'Escribile desde tu teléfono con «Abrir en WhatsApp».',
        })
        return
      }

      toast.error(result.message ?? 'No se pudo enviar el mensaje. Probá de nuevo.')
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
        toast.success('Mensaje aprobado enviado', {
          description: conversationLink(result.conversationId),
        })
        setOpen(false)
        return
      }

      toast.error(result.message ?? 'No se pudo enviar el mensaje aprobado. Probá de nuevo.')
    })
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm">
            <MessageCircle aria-hidden />
            Contactar
          </Button>
        )}
      </SheetTrigger>

      <SheetContent side="right" size="sm">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{displayPhone}</SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-4">
          {/* Una sola opción entre dos: segmentado del kit (flechas incluidas). */}
          <SegmentedControl
            aria-label="Qué mandar"
            fullWidth
            items={MODE_ITEMS}
            value={mode}
            onValueChange={setMode}
          />

          {mode === 'message' ? (
            <Field
              label="Mensaje"
              hint="Solo sale si el cliente te escribió en las últimas 24 horas. Si no, te pedimos un mensaje aprobado."
            >
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Escribí tu mensaje…"
                rows={5}
                maxLength={4096}
                className="resize-none"
              />
            </Field>
          ) : templatesLoading ? (
            <p role="status" className="flex items-center gap-2 type-body text-muted-foreground">
              <Spinner size={16} aria-hidden />
              Cargando los mensajes aprobados…
            </p>
          ) : templates.length === 0 ? (
            <p className="type-body text-muted-foreground">
              Todavía no hay mensajes aprobados. Se crean en{' '}
              <Link
                href={`/${tenantSlug}/mensajeria/plantillas`}
                className="text-foreground underline underline-offset-2"
              >
                Mensajería, en Plantillas
              </Link>
              .
            </p>
          ) : (
            <>
              <Field label="Mensaje aprobado">
                <Select
                  value={selectedTemplateId}
                  onValueChange={(v) => {
                    setSelectedTemplateId(v)
                    setTemplateVars([])
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí un mensaje…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id} description={t.language}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {selectedTemplateId ? (
                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-1 type-small text-muted-foreground">
                    Datos del mensaje (dejá vacío lo que no use)
                  </legend>
                  {Array.from({ length: VARIABLE_SLOTS }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: lista de slots fija, sin reordenamiento
                    <Field key={`var-${i}`} label={`Dato ${i + 1}`} optional>
                      <Input
                        size="sm"
                        value={templateVars[i] ?? ''}
                        onChange={(e) => {
                          const next = [...templateVars]
                          next[i] = e.target.value
                          setTemplateVars(next)
                        }}
                        placeholder={`Va en {{${i + 1}}}`}
                      />
                    </Field>
                  ))}
                </fieldset>
              ) : null}
            </>
          )}
        </SheetBody>

        <SheetFooter>
          {mode === 'message' ? (
            <Button onClick={handleSendMessage} disabled={!body.trim()} loading={isPending}>
              <Send aria-hidden />
              Enviar mensaje
            </Button>
          ) : (
            <Button onClick={handleSendTemplate} disabled={!selectedTemplateId} loading={isPending}>
              <Send aria-hidden />
              Enviar mensaje aprobado
            </Button>
          )}

          {waMeUrl ? (
            <Button asChild variant="secondary">
              <a href={waMeUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                Abrir en WhatsApp
                <span className="sr-only">, abre en otra pestaña</span>
              </a>
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
