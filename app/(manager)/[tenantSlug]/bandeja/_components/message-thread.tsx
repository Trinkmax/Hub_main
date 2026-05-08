'use client'

import { format } from 'date-fns'
import { Check, CheckCheck, Clock3, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MessageRow } from '@/lib/bandeja/queries'
import { createClient } from '@/lib/supabase/browser'
import { cn } from '@/lib/utils'

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
  conversationId,
  initialMessages,
}: {
  conversationId: string
  initialMessages: MessageRow[]
}) {
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMessages(initialMessages)
  }, [initialMessages])

  // biome-ignore lint/correctness/useExhaustiveDependencies: queremos disparar scroll cuando cambia la lista
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

  return (
    <div className="flex-1 space-y-2 overflow-y-auto bg-secondary/15 px-5 py-6">
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
