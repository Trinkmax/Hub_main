'use client'

import { Send, Sparkles } from 'lucide-react'
import { useActionState, useEffect, useMemo, useState } from 'react'
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

export function Composer({
  tenantSlug,
  conversationId,
  channelType,
  insideWindow,
  templates,
}: {
  tenantSlug: string
  conversationId: string
  channelType: ChannelType
  insideWindow: boolean
  templates: Template[]
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

  if (canSendText) {
    return (
      <form action={textAction} className="border-t border-border/60 bg-card p-3">
        <input type="hidden" name="conversation_id" value={conversationId} />
        <div className="flex items-end gap-2">
          <Textarea
            name="body"
            placeholder="Escribí tu mensaje…"
            rows={2}
            required
            maxLength={4096}
            className="flex-1 resize-none"
          />
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
          Estás fuera de la ventana de 24h. Solo podés mandar templates aprobados por Meta.
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
          <SelectValue placeholder="Elegí template aprobado" />
        </SelectTrigger>
        <SelectContent>
          {templates.length === 0 ? (
            <SelectItem value="__none" disabled>
              No hay templates aprobados
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
            Variables del template
          </p>
          {Array.from({ length: variableCount }).map((_, i) => (
            <Input
              // biome-ignore lint/suspicious/noArrayIndexKey: el orden es estable por contrato del template Meta ({{1}}, {{2}}…)
              key={`${selectedTemplateId || 'noop'}-${i}`}
              name="variable"
              placeholder={`{{${i + 1}}}`}
              required
            />
          ))}
        </div>
      ) : null}
      <Button type="submit" disabled={tplPending || !selectedTemplate} className="w-full gap-1.5">
        <Send className="size-4" />
        {tplPending ? 'Enviando…' : 'Enviar template'}
      </Button>
    </form>
  )
}
