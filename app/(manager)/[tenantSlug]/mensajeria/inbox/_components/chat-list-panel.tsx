'use client'

import { Camera, CheckCheck, ChevronDown, Search, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { formatListTimestamp } from '@/lib/bandeja/format'
import type { ConversationListRow } from '@/lib/bandeja/queries'
import {
  humanizeTemplateName,
  parseTemplateContent,
  type TemplateLite,
} from '@/lib/bandeja/template-view'
import { buildListHref } from '@/lib/bandeja/utils'
import type { ConversationTag } from '@/lib/conversation-tags/queries'
import { formatPhoneForDisplay } from '@/lib/phone'
import { createClient, realtimeAuthReady } from '@/lib/supabase/browser'
import { cn } from '@/lib/utils'
import { UnreadBadge } from '../../_components/wa-rail'
import { NewChatDialog } from './new-chat-dialog'
import { WaAvatar } from './wa-avatar'

function displayNameFor(c: ConversationListRow): string {
  if (c.customer_name) return c.customer_name
  if (c.channel_type === 'whatsapp') return formatPhoneForDisplay(c.external_user_id)
  return 'Cliente de Instagram'
}

/** El preview crudo de una plantilla es "[template:nombre] v1 | v2" — lo humanizamos. */
function previewTextFor(preview: string | null): string {
  if (!preview) return '\u00a0'
  const template = parseTemplateContent(preview)
  if (template) return `Mensaje aprobado · ${humanizeTemplateName(template.name)}`
  return preview
}

export function ChatListPanel({
  conversations,
  tenantSlug,
  tenantId,
  selectedId,
  hasMore,
  currentN,
  selectedTag,
  allTags,
  templates,
}: {
  conversations: ConversationListRow[]
  tenantSlug: string
  tenantId: string
  selectedId: string | null
  hasMore: boolean
  currentN: number
  selectedTag: string | null
  allTags: ConversationTag[]
  templates: TemplateLite[]
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [onlyUnread, setOnlyUnread] = useState(false)

  // Live updates: refresh the list whenever any conversation in this tenant changes
  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let disposed = false
    void realtimeAuthReady().then(() => {
      if (disposed) return
      channel = supabase
        .channel(`conversations-list:${tenantId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversations',
            filter: `tenant_id=eq.${tenantId}`,
          },
          () => {
            router.refresh()
          },
        )
        .subscribe((status, err) => {
          if (status !== 'SUBSCRIBED') {
            console.warn('[realtime:lista]', status, err?.message ?? '')
          }
        })
    })
    return () => {
      disposed = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [tenantId, router])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations.filter((c) => {
      if (onlyUnread && c.unread_count === 0) return false
      if (!q) return true
      const name = displayNameFor(c).toLowerCase()
      return (
        name.includes(q) ||
        c.external_user_id.includes(q.replace(/\D/g, '') || '\u0000') ||
        (c.preview ?? '').toLowerCase().includes(q)
      )
    })
  }, [conversations, query, onlyUnread])

  const loadMoreHref = buildListHref(tenantSlug, {
    n: currentN + 30,
    c: selectedId,
    tag: selectedTag,
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--wa-panel)">
      {/* Header: título + nuevo chat */}
      <header className="flex items-center justify-between px-4 pb-1 pt-3.5">
        {/* data-slot="page-title": el `.wa` le da el título compacto de 19 px
            (globals.css), el mismo que al PageHeader del resto de Mensajería. */}
        <h1 data-slot="page-title" className="text-(--wa-text)">
          Chats
        </h1>
        <NewChatDialog tenantSlug={tenantSlug} templates={templates} />
      </header>

      {/* Buscador */}
      <div className="px-3 pb-2 pt-1">
        {/* El buscador de WhatsApp (píldora). El foco se dibuja en la píldora
            entera, con el contorno del panel; 16 px con el dedo para que iOS
            no haga zoom al tocarlo. */}
        <div className="flex items-center gap-2 rounded-full bg-(--wa-panel-soft) px-3.5 py-2 outline-(--ring) -outline-offset-1 has-[input:focus-visible]:outline-2">
          <Search className="size-4 shrink-0 text-(--wa-muted)" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query !== '') {
                e.preventDefault()
                setQuery('')
              }
            }}
            placeholder="Buscar un chat"
            aria-label="Buscar un chat"
            autoComplete="off"
            className="w-full bg-transparent text-(length:--control-font) text-(--wa-text) outline-none placeholder:text-(--wa-muted) [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query !== '' ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Limpiar búsqueda"
              className="relative hit-area flex size-6 shrink-0 items-center justify-center rounded-full text-(--wa-muted) hover:text-(--wa-text)"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {/* Chips de filtro */}
      <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => {
            setOnlyUnread(false)
            if (selectedTag) {
              router.push(buildListHref(tenantSlug, { n: currentN, c: selectedId }))
            }
          }}
          aria-pressed={!onlyUnread && !selectedTag}
          className={cn(
            'shrink-0 rounded-full px-3 py-1 text-[13px] font-medium transition-colors',
            !onlyUnread && !selectedTag
              ? 'bg-(--wa-accent-soft) text-(--wa-accent-deep)'
              : 'bg-(--wa-panel-soft) text-(--wa-muted) hover:text-(--wa-text)',
          )}
        >
          Todos
        </button>
        <button
          type="button"
          onClick={() => setOnlyUnread((v) => !v)}
          aria-pressed={onlyUnread}
          className={cn(
            'shrink-0 rounded-full px-3 py-1 text-[13px] font-medium transition-colors',
            onlyUnread
              ? 'bg-(--wa-accent-soft) text-(--wa-accent-deep)'
              : 'bg-(--wa-panel-soft) text-(--wa-muted) hover:text-(--wa-text)',
          )}
        >
          No leídos
        </button>
        {allTags.map((tag) => {
          const active = selectedTag === tag.id
          return (
            <Link
              key={tag.id}
              href={
                active
                  ? buildListHref(tenantSlug, { n: currentN, c: selectedId })
                  : buildListHref(tenantSlug, { n: currentN, c: selectedId, tag: tag.id })
              }
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition-colors',
                active
                  ? 'bg-(--wa-accent-soft) text-(--wa-accent-deep)'
                  : 'bg-(--wa-panel-soft) text-(--wa-muted) hover:text-(--wa-text)',
              )}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color }}
                aria-hidden
              />
              {tag.name}
            </Link>
          )
        })}
      </div>

      {/* Lista */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-[13px] leading-relaxed text-(--wa-muted)">
            {conversations.length === 0
              ? 'Cuando un cliente te escriba por WhatsApp o Instagram, la charla aparece acá.'
              : onlyUnread && query.trim() === ''
                ? 'No tenés chats sin leer. 🎉'
                : 'No encontramos chats con esa búsqueda.'}
          </div>
        ) : (
          <ul>
            {filtered.map((c) => {
              const active = c.id === selectedId
              const display = displayNameFor(c)
              const initial = (display || '?').charAt(0).toUpperCase()
              const unread = c.unread_count > 0
              return (
                <li key={c.id}>
                  <Link
                    href={`/${tenantSlug}/mensajeria/inbox?c=${c.id}${selectedTag ? `&tag=${selectedTag}` : ''}${currentN > 30 ? `&n=${currentN}` : ''}`}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 transition-colors',
                      active ? 'bg-(--wa-active)' : 'hover:bg-(--wa-hover)',
                    )}
                  >
                    <div className="relative shrink-0">
                      <WaAvatar
                        seed={c.customer_name ?? c.external_user_id}
                        label={initial}
                        className="size-12 text-lg"
                      />
                      {c.channel_type === 'instagram' ? (
                        // Ícono y no «IG» en 7 px: nada de texto por debajo de 12 px.
                        <span
                          title="Instagram"
                          className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-[#d62976] text-white ring-2 ring-(--wa-panel)"
                        >
                          <Camera className="size-3" aria-hidden />
                          <span className="sr-only">Instagram</span>
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1 border-b border-(--wa-border) pb-2.5 pt-0.5 [li:last-child_&]:border-b-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-medium text-(--wa-text)">
                          {display}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-xs tabular-nums',
                            // Verde profundo: el claro de antes daba 2,9:1 sobre el panel.
                            unread ? 'font-semibold text-(--wa-accent-deep)' : 'text-(--wa-muted)',
                          )}
                        >
                          {formatListTimestamp(c.last_message_at)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'flex min-w-0 items-center gap-1 truncate text-[13px]',
                            unread ? 'font-medium text-(--wa-text)' : 'text-(--wa-muted)',
                          )}
                        >
                          {c.preview_direction === 'outbound' ? (
                            <CheckCheck
                              className="size-3.5 shrink-0 text-(--wa-muted)"
                              aria-label="Respondido por vos"
                            />
                          ) : null}
                          <span className="truncate">{previewTextFor(c.preview)}</span>
                        </span>
                        {unread ? (
                          <>
                            <UnreadBadge count={c.unread_count} className="shrink-0 px-1.5" />
                            <span className="sr-only">
                              {c.unread_count === 1
                                ? ', 1 mensaje sin leer'
                                : `, ${c.unread_count} mensajes sin leer`}
                            </span>
                          </>
                        ) : null}
                      </div>
                      {c.tags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.tags.map((tag) => (
                            // El nombre va en el texto del clon (el color de la etiqueta
                            // como letra no se leía: los de la paleta son claros); el
                            // color queda en el fondo y en el punto.
                            <span
                              key={tag.id}
                              className="inline-flex items-center gap-1 rounded-full px-1.5 type-caption font-medium text-(--wa-text-soft)"
                              style={{ backgroundColor: `${tag.color}26` }}
                            >
                              <span
                                className="size-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: tag.color }}
                                aria-hidden
                              />
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                </li>
              )
            })}
            {hasMore ? (
              <li>
                <Link
                  href={loadMoreHref}
                  className="flex w-full items-center justify-center gap-1.5 px-3 py-3 text-xs font-medium text-(--wa-muted) transition-colors hover:bg-(--wa-hover) hover:text-(--wa-text)"
                >
                  <ChevronDown className="size-3.5" aria-hidden />
                  Ver chats más viejos
                </Link>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  )
}
