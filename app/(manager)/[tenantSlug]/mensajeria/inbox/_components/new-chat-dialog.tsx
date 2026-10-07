'use client'

import { ArrowLeft, Loader2, Search, Send, SquarePen, Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  countBodyVariables,
  getTemplateBodyText,
  humanizeTemplateName,
  type TemplateLite,
} from '@/lib/bandeja/template-view'
import { searchCustomers } from '@/lib/customers/search'
import { contactCustomer } from '@/lib/meta/contact'
import { formatPhoneForDisplay } from '@/lib/phone'
import { cn } from '@/lib/utils'
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
      <DialogTrigger
        aria-label="Nuevo chat"
        title="Nuevo chat"
        className="flex size-9 items-center justify-center rounded-full text-(--wa-text-soft) transition-colors hover:bg-(--wa-hover) hover:text-(--wa-text) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--wa-accent)"
      >
        <SquarePen className="size-5" aria-hidden />
      </DialogTrigger>
      <DialogContent className="wa gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            {customer ? (
              <button
                type="button"
                onClick={() => {
                  setCustomer(null)
                  setNeedsTemplate(false)
                  setSelectedTemplate(null)
                }}
                aria-label="Volver a la búsqueda"
                className="-ml-1 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <ArrowLeft className="size-4" aria-hidden />
              </button>
            ) : null}
            {customer ? `Escribirle a ${customer.first_name}` : 'Nuevo chat'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {customer
              ? formatPhoneForDisplay(customer.phone)
              : 'Buscá a un cliente de tu lista para escribirle por WhatsApp.'}
          </DialogDescription>
        </DialogHeader>

        {!customer ? (
          <div className="flex max-h-[60dvh] flex-col">
            <div className="relative border-b px-4 py-2.5">
              <Search className="pointer-events-none absolute left-7 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nombre o teléfono…"
                className="h-9 pl-9"
              />
            </div>
            <div className="min-h-40 overflow-y-auto p-1.5">
              {searching ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Buscando…
                </p>
              ) : results.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {query.trim().length < 2
                    ? 'Escribí al menos 2 letras para buscar.'
                    : 'No encontramos clientes con ese nombre.'}
                </p>
              ) : (
                results.map((hit) => {
                  const name = `${hit.first_name} ${hit.last_name}`.trim()
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() => setCustomer(hit)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-secondary/60"
                    >
                      <WaAvatar
                        seed={name || hit.phone}
                        label={(name || '?').charAt(0).toUpperCase()}
                        className="size-10 text-base"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatPhoneForDisplay(hit.phone)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium tabular-nums text-secondary-foreground">
                        <Star className="size-3" aria-hidden />
                        {hit.points_balance.toLocaleString('es-AR')} pts
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        ) : !needsTemplate ? (
          <div className="flex flex-col gap-3 p-4">
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
            <Button
              onClick={handleSendText}
              disabled={!body.trim() || isPending}
              className="w-full gap-1.5 bg-(--wa-accent) text-white hover:bg-(--wa-accent-deep)"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              Enviar
            </Button>
          </div>
        ) : (
          <div className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto p-4">
            <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs leading-snug text-muted-foreground">
              Como {customer.first_name} no te escribió en las últimas 24 horas, WhatsApp pide
              arrancar con un <strong>mensaje aprobado</strong>. Elegí uno:
            </p>
            {templates.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No tenés mensajes aprobados todavía.
              </p>
            ) : (
              <div className="space-y-1">
                {templates.map((t) => {
                  const bodyText = getTemplateBodyText(t.components)
                  const active = selectedTemplate?.id === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setSelectedTemplate(t)
                        setVariables([])
                      }}
                      className={cn(
                        'flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                        active
                          ? 'border-(--wa-accent) bg-(--wa-accent-soft)'
                          : 'border-border hover:bg-secondary/60',
                      )}
                    >
                      <span className="text-sm font-medium">{humanizeTemplateName(t.name)}</span>
                      {bodyText ? (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {bodyText}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
            {selectedTemplate && templateVarCount > 0 ? (
              <div className="space-y-2">
                {Array.from({ length: templateVarCount }).map((_, i) => (
                  <Input
                    // biome-ignore lint/suspicious/noArrayIndexKey: el orden es estable por contrato del template Meta ({{1}}, {{2}}…)
                    key={`${selectedTemplate.id}-${i}`}
                    value={variables[i] ?? ''}
                    onChange={(e) => {
                      const next = [...variables]
                      next[i] = e.target.value
                      setVariables(next)
                    }}
                    placeholder={`Dato ${i + 1}`}
                  />
                ))}
              </div>
            ) : null}
            <Button
              onClick={handleSendTemplate}
              disabled={!selectedTemplate || isPending}
              className="w-full gap-1.5 bg-(--wa-accent) text-white hover:bg-(--wa-accent-deep)"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              Enviar mensaje aprobado
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
