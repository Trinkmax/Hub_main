'use client'

import { ArrowLeft, Send, SquarePen, Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, SearchField } from '@/components/ui/input'
import { RadioCards } from '@/components/ui/radio-cards'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import {
  countBodyVariables,
  getTemplateBodyText,
  humanizeTemplateName,
  type TemplateLite,
} from '@/lib/bandeja/template-view'
import { searchCustomers } from '@/lib/customers/search'
import { formatNumber } from '@/lib/format/number-kind'
import { contactCustomer } from '@/lib/meta/contact'
import { formatPhoneForDisplay } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { waActionClass } from '../../_components/wa-classes'
import { WaAvatar } from './wa-avatar'

type CustomerHit = {
  id: string
  first_name: string
  last_name: string
  phone: string
  points_balance: number
}

/**
 * "Nuevo chat" estilo WhatsApp: buscás al cliente por nombre o teléfono,
 * le escribís y caés directo en la conversación.
 *
 * El buscador sigue siendo propio (el `CustomerPicker` del kit llega en otra
 * ola); lo que cambió son las piezas: SearchField, Field, Badge y Spinner.
 */
export function NewChatDialog({
  tenantSlug,
  templates,
}: {
  tenantSlug: string
  templates: TemplateLite[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerHit[]>([])
  const [searching, setSearching] = useState(false)
  const [customer, setCustomer] = useState<CustomerHit | null>(null)
  const [body, setBody] = useState('')
  const [needsTemplate, setNeedsTemplate] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateLite | null>(null)
  const [variables, setVariables] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await searchCustomers(tenantSlug, q)
        setResults(hits)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, open, tenantSlug])

  function reset() {
    setQuery('')
    setResults([])
    setCustomer(null)
    setBody('')
    setNeedsTemplate(false)
    setSelectedTemplate(null)
    setVariables([])
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) reset()
  }

  function goToConversation(conversationId: string) {
    handleOpenChange(false)
    router.push(`/${tenantSlug}/mensajeria/inbox?c=${conversationId}`)
    router.refresh()
  }

  function handleSendText() {
    if (!customer || !body.trim() || isPending) return
    startTransition(async () => {
      const result = await contactCustomer(tenantSlug, {
        customer_id: customer.id,
        body: body.trim(),
      })
      if (result.ok) {
        toast.success('Mensaje enviado')
        goToConversation(result.conversationId)
        return
      }
      if (result.code === 'window_closed') {
        setNeedsTemplate(true)
        return
      }
      toast.error(result.message ?? 'No se pudo enviar el mensaje.')
    })
  }

  function handleSendTemplate() {
    if (!customer || !selectedTemplate || isPending) return
    const count = countBodyVariables(selectedTemplate.components)
    startTransition(async () => {
      const result = await contactCustomer(tenantSlug, {
        customer_id: customer.id,
        template: {
          name: selectedTemplate.name,
          language: selectedTemplate.language,
          variables: variables.slice(0, count),
        },
      })
      if (result.ok) {
        toast.success('Mensaje aprobado enviado')
        goToConversation(result.conversationId)
        return
      }
      toast.error(result.message ?? 'No se pudo enviar.')
    })
  }

  const templateVarCount = selectedTemplate ? countBodyVariables(selectedTemplate.components) : 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* El lápiz del encabezado de WhatsApp. Foco: el contorno del panel. */}
      <DialogTrigger
        aria-label="Nuevo chat"
        title="Nuevo chat"
        className="relative hit-area flex size-9 items-center justify-center rounded-full text-(--wa-text-soft) transition-colors hover:bg-(--wa-hover) hover:text-(--wa-text)"
      >
        <SquarePen className="size-5" aria-hidden />
      </DialogTrigger>
      <DialogContent size="sm" className="wa">
        <DialogHeader>
          {/* «Volver» afuera del título: si no, su nombre se colaba en el del diálogo. */}
          <div className="flex items-center gap-2">
            {customer ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="-ml-1.5 shrink-0"
                onClick={() => {
                  setCustomer(null)
                  setNeedsTemplate(false)
                  setSelectedTemplate(null)
                }}
                aria-label="Volver a la búsqueda"
              >
                <ArrowLeft aria-hidden />
              </Button>
            ) : null}
            <DialogTitle className="min-w-0 truncate">
              {customer ? `Escribirle a ${customer.first_name}` : 'Nuevo chat'}
            </DialogTitle>
          </div>
          <DialogDescription>
            {customer
              ? formatPhoneForDisplay(customer.phone)
              : 'Buscá a un cliente de tu lista para escribirle por WhatsApp.'}
          </DialogDescription>
        </DialogHeader>

        {!customer ? (
          <>
            <SearchField
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery('')}
              placeholder="Nombre o teléfono…"
              aria-label="Buscar cliente por nombre o teléfono"
            />
            <DialogBody className="min-h-40" aria-busy={searching || undefined}>
              {searching ? (
                <p
                  role="status"
                  className="flex items-center justify-center gap-2 py-10 type-body text-muted-foreground"
                >
                  <Spinner size={16} aria-hidden />
                  Buscando…
                </p>
              ) : results.length === 0 ? (
                <p className="px-4 py-10 text-center type-body text-muted-foreground">
                  {query.trim().length < 2
                    ? 'Escribí al menos 2 letras del nombre, o parte del teléfono.'
                    : 'No encontramos clientes con esa búsqueda. Probá con el apellido o el teléfono.'}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {results.map((hit) => {
                    const name = `${hit.first_name} ${hit.last_name}`.trim()
                    return (
                      <li key={hit.id}>
                        <button
                          type="button"
                          onClick={() => setCustomer(hit)}
                          className="flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-(--ring) -outline-offset-2 hover:bg-hover focus-visible:outline-2"
                        >
                          <WaAvatar
                            seed={name || hit.phone}
                            label={(name || '?').charAt(0).toUpperCase()}
                            className="size-10 text-base"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate type-body font-medium text-foreground">
                              {name}
                            </span>
                            <span className="block truncate type-small text-muted-foreground">
                              {formatPhoneForDisplay(hit.phone)}
                            </span>
                          </span>
                          {/* Puntos del club: el dorado es el sello del club. */}
                          <Badge tone="gold" icon={Star} className="tabular-nums">
                            {formatNumber(hit.points_balance)} pts
                          </Badge>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </DialogBody>
          </>
        ) : !needsTemplate ? (
          <>
            <Field
              label="Mensaje"
              hint="Enter envía; Mayús + Enter hace un salto de línea. Si no te escribió en las últimas 24 h, te pedimos un mensaje aprobado."
            >
              <Textarea
                autoFocus
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendText()
                  }
                }}
                placeholder="Escribí tu mensaje…"
                rows={4}
                maxLength={4096}
                className="resize-none"
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                onClick={handleSendText}
                disabled={!body.trim()}
                loading={isPending}
                className={cn('sm:min-w-32', waActionClass)}
              >
                <Send aria-hidden />
                Enviar
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody className="flex flex-col gap-3">
              <p className="rounded-lg bg-secondary px-3 py-2 type-small text-muted-foreground">
                Como {customer.first_name} no te escribió en las últimas 24 horas, WhatsApp pide
                arrancar con un <strong className="text-foreground">mensaje aprobado</strong>. Elegí
                uno:
              </p>
              {templates.length === 0 ? (
                <p className="py-4 text-center type-body text-muted-foreground">
                  No tenés mensajes aprobados todavía. Se crean en Mensajería, en Plantillas.
                </p>
              ) : (
                // Tarjetas-radio del kit: las flechas mueven y eligen.
                <RadioCards
                  size="sm"
                  aria-label="Mensaje aprobado"
                  value={selectedTemplate?.id ?? ''}
                  onValueChange={(id) => {
                    setSelectedTemplate(templates.find((t) => t.id === id) ?? null)
                    setVariables([])
                  }}
                  items={templates.map((t) => {
                    const bodyText = getTemplateBodyText(t.components)
                    return {
                      value: t.id,
                      label: humanizeTemplateName(t.name),
                      description: bodyText ? (
                        <span className="line-clamp-2">{bodyText}</span>
                      ) : undefined,
                    }
                  })}
                />
              )}
              {selectedTemplate && templateVarCount > 0 ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: templateVarCount }).map((_, i) => (
                    <Field
                      // biome-ignore lint/suspicious/noArrayIndexKey: el orden es estable por contrato del template Meta ({{1}}, {{2}}…)
                      key={`${selectedTemplate.id}-${i}`}
                      label={templateVarCount === 1 ? 'Dato del mensaje' : `Dato ${i + 1}`}
                    >
                      <Input
                        value={variables[i] ?? ''}
                        onChange={(e) => {
                          const next = [...variables]
                          next[i] = e.target.value
                          setVariables(next)
                        }}
                        placeholder="Ej: el nombre, una fecha…"
                      />
                    </Field>
                  ))}
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                onClick={handleSendTemplate}
                disabled={!selectedTemplate}
                loading={isPending}
                className={waActionClass}
              >
                <Send aria-hidden />
                Enviar mensaje aprobado
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
