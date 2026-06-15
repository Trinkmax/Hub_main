'use client'

import { format } from 'date-fns'
import { Check, CheckCheck, Clock3, Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { loadOlderMessages } from '@/lib/bandeja/actions'
import type { MessageRow } from '@/lib/bandeja/queries'
import { markConversationRead } from '@/lib/meta/actions'
import { createClient } from '@/lib/supabase/browser'
import { cn } from '@/lib/utils'

/** How many messages we load initially — if the initial batch is this size,
 *  there are probably older messages to paginate. */
const INITIAL_LIMIT = 50

function StatusIcon({ status }: { status: MessageRow['status'] }) {
  if (!status) return null
  if (status === 'queued') return <Clock3 className="size-3" />
  if (status === 'sent') return <Check className="size-3" />
  if (status === 'delivered') return <CheckCheck className="size-3" />
  if (status === 'read') return <CheckCheck className="size-3 text-info" />
  if (status === 'failed') return <TriangleAlert className="size-3 text-destructive" />
  return null
}

export function MessageThread({
  tenantSlug,
  conversationId,
  initialMessages,
}: {
  tenantSlug: string
  conversationId: string
  initialMessages: MessageRow[]
}) {
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages)
  const [hasOlder, setHasOlder] = useState(initialMessages.length >= INITIAL_LIMIT)
  const [isPending, startTransition] = useTransition()
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMessages(initialMessages)
    setHasOlder(initialMessages.length >= INITIAL_LIMIT)
  }, [initialMessages])

  // Fire-and-forget: mark conversation as read when the thread is opened
  useEffect(() => {
    void markConversationRead(tenantSlug, conversationId)
  }, [tenantSlug, conversationId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: queremos disparar scroll cuando cambia la lista
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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

  function handleLoadOlder() {
    const oldest = messages[0]
    if (!oldest) return
    // Save current scroll height before prepending so we can restore position
    const container = scrollRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0

    startTransition(async () => {
      const result = await loadOlderMessages(tenantSlug, conversationId, oldest.created_at)
      if (!result.ok) return
      const older = result.messages
      if (older.length === 0) {
        setHasOlder(false)
        return
      }
      setMessages((prev) => {
        // De-duplicate in case of overlaps
        const existingIds = new Set(prev.map((m) => m.id))
        const fresh = older.filter((m) => !existingIds.has(m.id))
        return [...fresh, ...prev]
      })
      // If fewer messages than the page size came back, we've reached the top
      if (older.length < 50) setHasOlder(false)

      // Restore scroll so the user stays at the same message they were reading
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight
        }
      })
    })
  }

  return (
    <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-secondary/15 px-5 py-6">
      {hasOlder ? (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={handleLoadOlder}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-60"
          >
            {isPending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
            Cargar mensajes anteriores
          </button>
        </div>
      ) : null}
      {messages.length === 0 ? (
        <p className="text-center text-xs text-muted-foreground">Sin mensajes.</p>
      ) : null}
      {messages.map((m) => {
        const outbound = m.direction === 'outbound'
        return (
          <div key={m.id} className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
                outbound
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'rounded-bl-sm bg-card text-card-foreground border border-border/60',
              )}
            >
              <p className="whitespace-pre-wrap text-pretty">{m.content ?? '(sin contenido)'}</p>
              <p
                className={cn(
                  'mt-1 flex items-center justify-end gap-1 text-[10px]',
                  outbound ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}
              >
                <span className="tabular-nums">
                  {format(new Date(m.sent_at ?? m.created_at), 'HH:mm')}
                </span>
                {outbound && m.status ? <StatusIcon status={m.status} /> : null}
                {m.error ? <span className="ml-1 truncate">· {m.error}</span> : null}
              </p>
            </div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
