'use client'

import { BadgeCheck, Loader2, Lock, Plus, SendHorizontal, Zap } from 'lucide-react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { TemplateLite } from '@/lib/bandeja/template-view'
import { sendTextMessage } from '@/lib/meta/actions'
import type { QuickMessageRow } from '@/lib/quick-messages/queries'
import { cn } from '@/lib/utils'
import type { ChannelType } from '@/types/database'
import { TemplateDialog } from './template-dialog'

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

  return (
    <div
      role="listbox"
      aria-label="Mensajes rápidos"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-56 overflow-y-auto rounded-xl border border-(--wa-border) bg-(--wa-panel) py-1 shadow-lg"
    >
      {filtered.length === 0 ? (
        <p className="px-3 py-2.5 text-xs text-(--wa-muted)">Sin resultados para «/{query}»</p>
      ) : (
        filtered.map((msg, i) => (
          <button
            key={msg.id}
            type="button"
            role="option"
            aria-selected={i === highlighted}
            className={cn(
              'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors',
              i === highlighted ? 'bg-(--wa-active)' : 'hover:bg-(--wa-hover)',
            )}
            onClick={() => onSelect(msg.body)}
            onMouseEnter={() => setHighlighted(i)}
          >
            <span className="flex items-center gap-1.5">
              <span className="font-medium leading-tight text-(--wa-text)">{msg.title}</span>
              <span className="rounded bg-(--wa-panel-soft) px-1 font-mono text-[10px] text-(--wa-muted)">
                /{msg.shortcut}
              </span>
            </span>
            <span className="truncate text-xs text-(--wa-muted)">{msg.body}</span>
          </button>
        ))
      )}
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
  canManageTemplates = true,
}: {
  tenantSlug: string
  conversationId: string
  channelType: ChannelType
  insideWindow: boolean
  templates: TemplateLite[]
  quickMessages: QuickMessageRow[]
  /** false para staff sin acceso al workspace manager (salón): oculta el link a Plantillas. */
  canManageTemplates?: boolean
}) {
  const canSendText = insideWindow || channelType === 'instagram'

  const [body, setBody] = useState('')
  const [pickerQuery, setPickerQuery] = useState<string | null>(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // En pantallas táctiles (salón) Enter hace salto de línea, como WhatsApp mobile
  const coarsePointerRef = useRef(false)
  useEffect(() => {
    coarsePointerRef.current = window.matchMedia('(pointer: coarse)').matches
  }, [])

  function autosize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }

  function handleBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setBody(val)
    autosize()
    if (val.startsWith('/') && quickMessages.length > 0) {
      setPickerQuery(val.slice(1))
    } else {
      setPickerQuery(null)
    }
  }

  function handleQuickMessageSelect(selectedBody: string) {
    setBody(selectedBody)
    setPickerQuery(null)
    textareaRef.current?.focus()
    requestAnimationFrame(autosize)
  }

  function handleSend() {
    const text = body.trim()
    if (!text || isPending) return
    // Optimista, como WhatsApp: limpiamos ya y restauramos si falla
    setBody('')
    setPickerQuery(null)
    requestAnimationFrame(autosize)
    const fd = new FormData()
    fd.set('conversation_id', conversationId)
    fd.set('body', text)
    startTransition(async () => {
      const result = await sendTextMessage(tenantSlug, { ok: true }, fd)
      if (!result.ok) {
        toast.error(result.message ?? 'No se pudo enviar el mensaje.')
        setBody(text)
        requestAnimationFrame(autosize)
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && pickerQuery === null && !coarsePointerRef.current) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!canSendText) {
    // Fuera de la ventana de 24 h (solo WhatsApp): explicación en criollo +
    // acceso directo a los mensajes aprobados.
    return (
      <div className="border-t border-(--wa-border) bg-(--wa-composer) px-4 py-3">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-2.5 text-center">
          <p className="flex items-start gap-2 text-[13px] leading-snug text-(--wa-text-soft)">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Pasaron más de 24 horas desde el último mensaje de esta persona, así que WhatsApp solo
              deja retomar la charla con un <strong>mensaje aprobado</strong>. Cuando te conteste,
              volvés a escribir libre.
            </span>
          </p>
          {templates.length > 0 ? (
            <button
              type="button"
              onClick={() => setTemplateOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-(--wa-accent) px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-(--wa-accent-deep)"
            >
              <BadgeCheck className="size-4" aria-hidden />
              Enviar mensaje aprobado
            </button>
          ) : (
            <p className="text-xs text-(--wa-muted)">
              {canManageTemplates ? (
                <>
                  Todavía no tenés mensajes aprobados. Crealos en{' '}
                  <a
                    href={`/${tenantSlug}/mensajeria/plantillas`}
                    className="font-medium text-(--wa-accent-deep) underline underline-offset-2"
                  >
                    Plantillas
                  </a>
                  .
                </>
              ) : (
                'Todavía no hay mensajes aprobados. Pedile al dueño que los cree.'
              )}
            </p>
          )}
        </div>
        <TemplateDialog
          tenantSlug={tenantSlug}
          conversationId={conversationId}
          templates={templates}
          open={templateOpen}
          onOpenChange={setTemplateOpen}
        />
      </div>
    )
  }

  return (
    <div className="border-t border-(--wa-border) bg-(--wa-composer) px-3 py-2.5 md:px-4">
      <div className="relative flex items-end gap-2">
        {pickerQuery !== null && quickMessages.length > 0 && (
          <QuickMessagePicker
            query={pickerQuery}
            quickMessages={quickMessages}
            onSelect={handleQuickMessageSelect}
            onClose={() => {
              setPickerQuery(null)
              textareaRef.current?.focus()
            }}
          />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Más opciones"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-(--wa-text-soft) transition-colors hover:bg-(--wa-hover) hover:text-(--wa-text) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--wa-accent)"
          >
            <Plus className="size-6" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            {quickMessages.length > 0 ? (
              <DropdownMenuItem
                onSelect={() => {
                  setBody('/')
                  setPickerQuery('')
                  textareaRef.current?.focus()
                }}
              >
                <Zap className="size-4" aria-hidden />
                Mensaje rápido
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">/</span>
              </DropdownMenuItem>
            ) : null}
            {channelType === 'whatsapp' && templates.length > 0 ? (
              <DropdownMenuItem onSelect={() => setTemplateOpen(true)}>
                <BadgeCheck className="size-4" aria-hidden />
                Mensaje aprobado
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex min-h-10 flex-1 items-center rounded-3xl bg-(--wa-input) px-4 py-2">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={handleBodyChange}
            onKeyDown={handleKeyDown}
            placeholder={
              quickMessages.length > 0
                ? 'Escribí un mensaje o / para rápidos'
                : 'Escribí un mensaje'
            }
            rows={1}
            maxLength={4096}
            aria-label="Mensaje"
            className="max-h-[140px] w-full resize-none bg-transparent text-[16px] leading-6 md:text-[15px] text-(--wa-text) outline-none placeholder:text-(--wa-muted)"
          />
        </div>

        <button
          type="button"
          onClick={handleSend}
          disabled={isPending || body.trim() === ''}
          aria-label="Enviar mensaje"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-(--wa-accent) text-white transition-all hover:bg-(--wa-accent-deep) disabled:cursor-default disabled:opacity-40"
        >
          {isPending ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <SendHorizontal className="size-5" aria-hidden />
          )}
        </button>
      </div>

      <TemplateDialog
        tenantSlug={tenantSlug}
        conversationId={conversationId}
        templates={templates}
        open={templateOpen}
        onOpenChange={setTemplateOpen}
      />
    </div>
  )
}
