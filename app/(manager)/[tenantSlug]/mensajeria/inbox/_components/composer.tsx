'use client'

import { Send, Sparkles, Zap } from 'lucide-react'
import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { type MetaActionState, sendTemplateMessage, sendTextMessage } from '@/lib/meta/actions'
import type { QuickMessageRow } from '@/lib/quick-messages/queries'
import type { ChannelType } from '@/types/database'

type Template = {
  id: string
  name: string
  language: string
  category: string
  components: unknown
}

const initial: MetaActionState = { ok: true }

function countBodyVariables(components: unknown): number {
  if (!Array.isArray(components)) return 0
  for (const c of components) {
    if (c && typeof c === 'object' && (c as Record<string, unknown>).type === 'BODY') {
      const text = (c as { text?: string }).text ?? ''
      const matches = text.match(/\{\{\d+\}\}/g)
      return matches ? matches.length : 0
    }
  }
  return 0
}

function QuickMessagePicker({
  query,
  quickMessages,
  onSelect,
  onClose,
}: {
  query: string
  quickMessages: QuickMessageRow[]
  onSelect: (body: string) => void
  onClose: () => void
}) {
  const lower = query.toLowerCase()
  const filtered = quickMessages.filter(
    (m) => m.shortcut.includes(lower) || m.title.toLowerCase().includes(lower),
  )
  const [highlighted, setHighlighted] = useState(0)

  // Reset highlight when filter changes (query es prop, Biome no lo detecta como outer dep)
  // biome-ignore lint/correctness/useExhaustiveDependencies: query es la prop que dispara el reset
  useEffect(() => {
    setHighlighted(0)
  }, [query])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((h) => Math.max(h - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const selected = filtered[highlighted]
        if (selected) onSelect(selected.body)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtered, highlighted, onSelect, onClose])

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border bg-popover p-3 shadow-md">
        <p className="text-xs text-muted-foreground">Sin resultados para «/{query}»</p>
      </div>
    )
  }

  return (
    <div
      role="listbox"
      aria-label="Mensajes rápidos"
      className="absolute bottom-full left-0 right-0 mb-1 max-h-52 overflow-y-auto rounded-lg border border-border bg-popover shadow-md"
    >
      {filtered.map((msg, i) => (
        <button
          key={msg.id}
          type="button"
          role="option"
          aria-selected={i === highlighted}
          className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
            i === highlighted ? 'bg-accent text-accent-foreground' : ''
          }`}
          onClick={() => onSelect(msg.body)}
          onMouseEnter={() => setHighlighted(i)}
        >
          <span className="flex items-center gap-1.5">
            <span className="font-medium leading-tight">{msg.title}</span>
            <span className="font-mono rounded bg-secondary/60 px-1 text-[10px] text-muted-foreground">
              /{msg.shortcut}
            </span>
          </span>
          <span className="truncate text-xs text-muted-foreground">{msg.body}</span>
        </button>
      ))}
    </div>
  )
}

export function Composer({
  tenantSlug,
  conversationId,
  channelType,
  insideWindow,
  templates,
  quickMessages,
}: {
  tenantSlug: string
  conversationId: string
  channelType: ChannelType
  insideWindow: boolean
  templates: Template[]
  quickMessages: QuickMessageRow[]
}) {
  const canSendText = insideWindow || channelType === 'instagram'

  const [textState, textAction, textPending] = useActionState(
    sendTextMessage.bind(null, tenantSlug),
    initial,
  )
  const [tplState, tplAction, tplPending] = useActionState(
    sendTemplateMessage.bind(null, tenantSlug),
    initial,
  )

  useEffect(() => {
    if (!textState.ok && textState.message) toast.error(textState.message)
  }, [textState])

  useEffect(() => {
    if (!tplState.ok && tplState.message) toast.error(tplState.message)
  }, [tplState])

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  )
  const variableCount = selectedTemplate ? countBodyVariables(selectedTemplate.components) : 0

  // Quick-message picker state
  const [bodyValue, setBodyValue] = useState('')
  const [pickerQuery, setPickerQuery] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function handleBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setBodyValue(val)
    // Show picker only when the textarea starts with "/" (optionally followed by query chars)
    if (val.startsWith('/')) {
      setPickerQuery(val.slice(1))
    } else {
      setPickerQuery(null)
    }
  }

  function handleQuickMessageSelect(body: string) {
    setBodyValue(body)
    setPickerQuery(null)
    // Focus back on textarea
    textareaRef.current?.focus()
  }

  function handlePickerClose() {
    setPickerQuery(null)
    textareaRef.current?.focus()
  }

  // Clear body after successful send
  useEffect(() => {
    if (textState.ok) {
      setBodyValue('')
      setPickerQuery(null)
    }
  }, [textState])

  if (canSendText) {
    return (
      <form ref={formRef} action={textAction} className="border-t border-border/60 bg-card p-3">
        <input type="hidden" name="conversation_id" value={conversationId} />
        <div className="relative flex items-end gap-2">
          {pickerQuery !== null && quickMessages.length > 0 && (
            <QuickMessagePicker
              query={pickerQuery}
              quickMessages={quickMessages}
              onSelect={handleQuickMessageSelect}
              onClose={handlePickerClose}
            />
          )}
          <div className="relative flex-1">
            <Textarea
              ref={textareaRef}
              name="body"
              value={bodyValue}
              onChange={handleBodyChange}
              placeholder={
                quickMessages.length > 0
                  ? 'Escribí tu mensaje… o / para mensajes rápidos'
                  : 'Escribí tu mensaje…'
              }
              rows={2}
              required
              maxLength={4096}
              className="resize-none"
            />
            {quickMessages.length > 0 && (
              <button
                type="button"
                title="Mensajes rápidos (/)"
                aria-label="Abrir mensajes rápidos"
                className="absolute bottom-2 right-2 flex size-5 items-center justify-center rounded text-muted-foreground opacity-50 transition-opacity hover:opacity-100"
                onClick={() => {
                  if (pickerQuery !== null) {
                    handlePickerClose()
                  } else {
                    setBodyValue('/')
                    setPickerQuery('')
                    textareaRef.current?.focus()
                  }
                }}
              >
                <Zap className="size-3.5" />
              </button>
            )}
          </div>
          <Button type="submit" disabled={textPending} className="gap-1.5" size="lg">
            <Send className="size-4" />
            {textPending ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <form action={tplAction} className="space-y-3 border-t border-border/60 bg-card p-3">
      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
        <Sparkles className="mt-0.5 size-3.5 shrink-0" />
        <span className="text-pretty">
          Pasaron más de 24 h desde el último mensaje de esta persona. Para escribirle ahora tenés
          que usar una plantilla (un mensaje ya aprobado por WhatsApp). Cuando te vuelva a escribir,
          podés responder libre otra vez.
        </span>
      </div>
      <input type="hidden" name="conversation_id" value={conversationId} />
      <Select
        name="template_name"
        value={selectedTemplate?.name ?? ''}
        onValueChange={(value) => {
          const t = templates.find((x) => x.name === value)
          setSelectedTemplateId(t?.id ?? '')
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Elegí una plantilla" />
        </SelectTrigger>
        <SelectContent>
          {templates.length === 0 ? (
            <SelectItem value="__none" disabled>
              Todavía no tenés plantillas aprobadas
            </SelectItem>
          ) : (
            templates.map((t) => (
              <SelectItem key={t.id} value={t.name}>
                {t.name} <span className="ml-1 text-muted-foreground">({t.language})</span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      {selectedTemplate ? (
        <input type="hidden" name="template_language" value={selectedTemplate.language} />
      ) : null}
      {variableCount > 0 ? (
        <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Completá los datos
          </p>
          {Array.from({ length: variableCount }).map((_, i) => (
            <Input
              // biome-ignore lint/suspicious/noArrayIndexKey: el orden es estable por contrato del template Meta ({{1}}, {{2}}…)
              key={`${selectedTemplateId || 'noop'}-${i}`}
              name="variable"
              placeholder={`Dato ${i + 1}`}
              required
            />
          ))}
        </div>
      ) : null}
      <Button type="submit" disabled={tplPending || !selectedTemplate} className="w-full gap-1.5">
        <Send className="size-4" />
        {tplPending ? 'Enviando…' : 'Enviar plantilla'}
      </Button>
    </form>
  )
}
