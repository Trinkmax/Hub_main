'use client'

import { format } from 'date-fns'
import {
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  FileText,
  Loader2,
  Megaphone,
  TriangleAlert,
  Workflow,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import { loadOlderMessages } from '@/lib/bandeja/actions'
import { dayKey, formatDaySeparator } from '@/lib/bandeja/format'
import type { MessageRow } from '@/lib/bandeja/queries'
import {
  humanizeTemplateName,
  renderSentTemplate,
  type TemplateLite,
} from '@/lib/bandeja/template-view'
import { markConversationRead } from '@/lib/meta/actions'
import { createClient } from '@/lib/supabase/browser'
import { cn } from '@/lib/utils'

/** How many messages we load initially — if the initial batch is this size,
 *  there are probably older messages to paginate. */
const INITIAL_LIMIT = 50

// Placeholders cuando la descarga todavía no completó
const MEDIA_PLACEHOLDER: Record<string, string> = {
  image: '📷 Foto',
  video: '🎥 Video',
  audio: '🎵 Audio',
  sticker: '🖼 Sticker',
  document: '📎 Documento',
}

function MediaBubble({ message }: { message: MessageRow }) {
  const { media, media_url, media_type, media_mime } = message

  if (!media || typeof media !== 'object') return null

  const type = media_type ?? ((media as Record<string, unknown>).type as string | undefined)

  if (media_url) {
    if (type === 'image' || type === 'sticker') {
      return (
        // biome-ignore lint/performance/noImgElement: media de chat con dimensiones desconocidas (signed URL), no apto para next/image
        <img
          src={media_url}
          alt={type === 'sticker' ? 'Sticker' : 'Imagen'}
          className="mb-1 max-h-72 max-w-full rounded-lg object-contain"
        />
      )
    }
    if (type === 'video') {
      return (
        // biome-ignore lint/a11y/useMediaCaption: no hay transcripción disponible para mensajes de usuario
        <video src={media_url} controls className="mb-1 max-h-72 max-w-full rounded-lg" />
      )
    }
    if (type === 'audio') {
      return (
        // biome-ignore lint/a11y/useMediaCaption: audio de WhatsApp no tiene transcripción
        <audio src={media_url} controls className="mb-1 w-full min-w-[220px]" />
      )
    }
    const filename = (media as Record<string, unknown>).filename as string | undefined
    return (
      <a
        href={media_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm underline-offset-2 hover:underline dark:bg-white/10"
      >
        <FileText className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{filename ?? media_mime ?? 'Documento'}</span>
      </a>
    )
  }

  const placeholder = MEDIA_PLACEHOLDER[type ?? ''] ?? '📎 Adjunto'
  return <p className="mb-1 text-sm italic opacity-70">{placeholder}…</p>
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'En cola',
  sent: 'Enviado',
  delivered: 'Entregado',
  read: 'Leído',
  failed: 'No se pudo enviar',
}

function StatusTicks({ status }: { status: MessageRow['status'] }) {
  if (!status) return null
  const label = STATUS_LABEL[status] ?? ''
  const icon =
    status === 'queued' ? (
      <Clock3 className="size-3.5" />
    ) : status === 'sent' ? (
      <Check className="size-3.5" />
    ) : status === 'delivered' ? (
      <CheckCheck className="size-3.5" />
    ) : status === 'read' ? (
      <CheckCheck className="size-3.5 text-(--wa-tick)" />
    ) : status === 'failed' ? (
      <TriangleAlert className="size-3.5 text-destructive" />
    ) : null
  if (!icon) return null
  return (
    <span title={label} aria-label={label} role="img" className="inline-flex">
      {icon}
    </span>
  )
}

// Traduce los errores más comunes de WhatsApp a algo entendible; el crudo va en el title.
function friendlyError(raw: string): string {
  const r = raw.toLowerCase()
  if (r.includes('131047') || r.includes('re-engagement') || r.includes('24 h')) {
    return 'Pasaron 24 horas: hace falta un mensaje aprobado'
  }
  if (r.includes('131026') || r.includes('undeliverable') || r.includes('not a whatsapp')) {
    return 'No se pudo entregar'
  }
  if (r.includes('block')) return 'El cliente bloqueó los mensajes'
  return 'No se pudo enviar'
}

/** Colita de la burbuja, calcada del SVG de WhatsApp Web. */
function BubbleTail({ outbound }: { outbound: boolean }) {
  return (
    <svg
      viewBox="0 0 8 13"
      width="8"
      height="13"
      aria-hidden="true"
      role="presentation"
      className={cn(
        'absolute top-0',
        outbound ? '-right-2 text-(--wa-bubble-out)' : '-left-2 text-(--wa-bubble-in)',
      )}
    >
      {outbound ? (
        <path fill="currentColor" d="M0 0h8L2.6 7.4C1.5 8.8 0 8.3 0 6.4Z" />
      ) : (
        <path fill="currentColor" d="M8 0H0l5.4 7.4C6.5 8.8 8 8.3 8 6.4Z" />
      )}
    </svg>
  )
}

export function MessageThread({
  tenantSlug,
  conversationId,
  initialMessages,
  templates = [],
}: {
  tenantSlug: string
  conversationId: string
  initialMessages: MessageRow[]
  /** Plantillas aprobadas — para mostrar el texto real de mensajes de plantilla. */
  templates?: TemplateLite[]
}) {
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages)
  const [hasOlder, setHasOlder] = useState(initialMessages.length >= INITIAL_LIMIT)
  const [showJump, setShowJump] = useState(false)
  const [isPending, startTransition] = useTransition()
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Ids presentes en el primer render: los que lleguen después se animan
  const initialIdsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)))
  // Scroll inteligente: solo bajamos si el usuario está al fondo (o mandó él)
  const atBottomRef = useRef(true)
  const lastIdRef = useRef<string | null>(null)
  const didInitialScrollRef = useRef(false)
  // Alto previo del scroll cuando se prepende historial (para restaurar posición)
  const prependHeightRef = useRef<number | null>(null)

  useEffect(() => {
    setMessages(initialMessages)
    setHasOlder(initialMessages.length >= INITIAL_LIMIT)
  }, [initialMessages])

  // Fire-and-forget: mark conversation as read when the thread is opened
  useEffect(() => {
    void markConversationRead(tenantSlug, conversationId)
  }, [tenantSlug, conversationId])

  // Scroll como WhatsApp: al abrir va al fondo; después solo sigue la charla
  // si estás al fondo o el último mensaje es tuyo. Leer historial no te patea.
  useLayoutEffect(() => {
    const container = scrollRef.current
    // Prepend de "Ver mensajes anteriores": restaurar la posición de lectura
    if (prependHeightRef.current != null) {
      if (container) {
        container.scrollTop = container.scrollHeight - prependHeightRef.current
      }
      prependHeightRef.current = null
      lastIdRef.current = messages[messages.length - 1]?.id ?? null
      return
    }
    const last = messages[messages.length - 1] ?? null
    if ((last?.id ?? null) === lastIdRef.current) return
    lastIdRef.current = last?.id ?? null
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true
      bottomRef.current?.scrollIntoView()
      return
    }
    if (atBottomRef.current || last?.direction === 'outbound') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Realtime: append new messages and update status changes
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new as MessageRow
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new as MessageRow
          setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)))
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  // Botón "bajar al final" + tracking de si el usuario está al fondo
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    function onScroll() {
      if (!container) return
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight
      atBottomRef.current = distance < 120
      setShowJump(distance > 320)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [])

  function handleLoadOlder() {
    const oldest = messages[0]
    if (!oldest) return

    startTransition(async () => {
      const result = await loadOlderMessages(tenantSlug, conversationId, oldest.created_at)
      if (!result.ok) return
      const older = result.messages
      if (older.length === 0) {
        setHasOlder(false)
        return
      }
      for (const m of older) initialIdsRef.current.add(m.id)
      // El useLayoutEffect restaura la posición cuando React commitea el prepend
      prependHeightRef.current = scrollRef.current?.scrollHeight ?? 0
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id))
        const fresh = older.filter((m) => !existingIds.has(m.id))
        return [...fresh, ...prev]
      })
      if (older.length < 50) setHasOlder(false)
    })
  }

  // Agrupar por día calendario, preservando el orden ASC
  const dayGroups = useMemo(() => {
    const groups: { key: string; label: string; items: MessageRow[] }[] = []
    for (const m of messages) {
      const iso = m.sent_at ?? m.created_at
      const key = dayKey(iso)
      const last = groups[groups.length - 1]
      if (last && last.key === key) {
        last.items.push(m)
      } else {
        groups.push({ key, label: formatDaySeparator(iso), items: m ? [m] : [] })
      }
    }
    return groups
  }, [messages])

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} className="wa-wallpaper h-full overflow-y-auto px-4 py-3 md:px-[6%]">
        {hasOlder ? (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-full bg-(--wa-system-pill) px-3.5 py-1.5 text-xs font-medium text-(--wa-text-soft) shadow-sm transition-colors hover:text-(--wa-text) disabled:opacity-60"
            >
              {isPending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              Ver mensajes anteriores
            </button>
          </div>
        ) : null}

        {messages.length === 0 ? (
          <div className="flex justify-center pt-6">
            <p className="rounded-full bg-(--wa-system-pill) px-4 py-1.5 text-xs text-(--wa-text-soft) shadow-sm">
              Sin mensajes todavía.
            </p>
          </div>
        ) : null}

        {dayGroups.map((group) => (
          // key por primer mensaje: dayKey puede repetirse si sent_at viene desordenado
          <div key={group.items[0]?.id ?? group.key} className="relative">
            <div className="sticky top-1 z-10 my-2.5 flex justify-center">
              <span className="rounded-lg bg-(--wa-system-pill) px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-(--wa-text-soft) shadow-sm">
                {group.label}
              </span>
            </div>
            {group.items.map((m, i) => {
              const outbound = m.direction === 'outbound'
              const prev = group.items[i - 1]
              const groupStart = !prev || prev.direction !== m.direction
              const animate = !initialIdsRef.current.has(m.id)
              const template = m.content ? renderSentTemplate(m.content, templates) : null
              const bodyText = template ? template.body : m.content
              const fromBroadcast = m.broadcast_id != null
              const fromFlow = m.flow_execution_id != null
              return (
                <div
                  key={m.id}
                  className={cn(
                    'flex',
                    outbound ? 'justify-end' : 'justify-start',
                    groupStart ? 'mt-2.5' : 'mt-[3px]',
                    animate && 'wa-message-in',
                  )}
                >
                  <div
                    className={cn(
                      'relative max-w-[85%] rounded-lg px-2.5 py-1.5 text-[14.2px] leading-[19px] text-(--wa-text) shadow-sm md:max-w-[65%]',
                      outbound ? 'bg-(--wa-bubble-out)' : 'bg-(--wa-bubble-in)',
                      groupStart && (outbound ? 'rounded-tr-none' : 'rounded-tl-none'),
                    )}
                  >
                    {groupStart ? <BubbleTail outbound={outbound} /> : null}

                    {fromBroadcast || fromFlow || template ? (
                      <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-(--wa-accent-deep)">
                        {fromBroadcast ? (
                          <>
                            <Megaphone className="size-3" aria-hidden />
                            Enviado por difusión
                          </>
                        ) : fromFlow ? (
                          <>
                            <Workflow className="size-3" aria-hidden />
                            Enviado automático
                          </>
                        ) : (
                          'Mensaje aprobado'
                        )}
                      </p>
                    ) : null}

                    <MediaBubble message={m} />

                    {bodyText ? (
                      <p className="whitespace-pre-wrap break-words">
                        {bodyText}
                        {/* espaciador para que el texto no pise la hora */}
                        <span className="inline-block w-16" aria-hidden />
                      </p>
                    ) : template ? (
                      <p className="italic opacity-80">
                        Mensaje aprobado «{humanizeTemplateName(template.name)}»
                        <span className="inline-block w-16" aria-hidden />
                      </p>
                    ) : !m.media ? (
                      <p className="italic opacity-60">
                        Sin contenido
                        <span className="inline-block w-16" aria-hidden />
                      </p>
                    ) : null}

                    <span
                      className={cn(
                        'absolute bottom-1 right-2 flex items-center gap-0.5 text-[11px] leading-none',
                        outbound ? 'text-(--wa-bubble-meta-out)' : 'text-(--wa-bubble-meta)',
                      )}
                    >
                      <span className="tabular-nums">
                        {format(new Date(m.sent_at ?? m.created_at), 'HH:mm')}
                      </span>
                      {outbound ? <StatusTicks status={m.status} /> : null}
                    </span>

                    {m.error ? (
                      <p
                        title={m.error}
                        className="mt-1 flex items-center gap-1 text-[11px] text-destructive"
                      >
                        <TriangleAlert className="size-3 shrink-0" aria-hidden />
                        {friendlyError(m.error)}
                      </p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {showJump ? (
        <button
          type="button"
          aria-label="Ir al último mensaje"
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="absolute bottom-4 right-4 flex size-10 items-center justify-center rounded-full bg-(--wa-panel) text-(--wa-text-soft) shadow-md transition-transform hover:scale-105"
        >
          <ChevronDown className="size-5" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
