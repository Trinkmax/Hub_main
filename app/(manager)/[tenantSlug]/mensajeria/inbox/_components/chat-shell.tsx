'use client'

import { ArrowLeft, BadgeCheck, Clock, Star, X } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import { WaAvatar } from './wa-avatar'

/**
 * Marco cliente de la conversación: header estilo WhatsApp (clic → ficha del
 * cliente), hilo, composer y drawer derecho de "Info. del cliente".
 */
export function ChatShell({
  display,
  subtitle,
  avatarSeed,
  backHref,
  isWhatsApp,
  insideWindow,
  replyUntil,
  loyalty,
  tagPicker,
  contactPanel,
  thread,
  composer,
}: {
  display: string
  subtitle: string
  avatarSeed: string
  backHref: string
  isWhatsApp: boolean
  insideWindow: boolean
  replyUntil: string | null
  loyalty: { points: number; tierName: string | null; tierColor: string | null } | null
  tagPicker: ReactNode
  contactPanel: ReactNode
  thread: ReactNode
  composer: ReactNode
}) {
  const [panelOpen, setPanelOpen] = useState(false)

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="@container flex h-[59px] shrink-0 items-center gap-1.5 border-b border-(--wa-border) bg-(--wa-panel) pl-2 pr-3 md:pl-3">
          <Link
            href={backHref}
            aria-label="Volver a la lista de chats"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-(--wa-text-soft) transition-colors hover:bg-(--wa-hover) md:hidden"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>

          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 pl-1 pr-2 text-left transition-colors hover:bg-(--wa-hover)"
            title="Ver la ficha del cliente"
          >
            <WaAvatar
              seed={avatarSeed}
              label={(display || '?').charAt(0).toUpperCase()}
              className="size-10 text-base"
            />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold leading-tight text-(--wa-text)">
                {display}
              </span>
              <span className="block truncate text-xs leading-tight text-(--wa-muted)">
                {subtitle}
              </span>
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-1.5">
            {loyalty ? (
              <span
                title="Puntos para canjear del cliente"
                className="hidden items-center gap-1 rounded-full bg-(--wa-panel-soft) px-2.5 py-1 text-xs font-medium tabular-nums text-(--wa-text-soft) @xl:flex"
              >
                <Star className="size-3.5 text-(--wa-accent)" aria-hidden />
                {loyalty.points.toLocaleString('es-AR')}
              </span>
            ) : null}
            {loyalty?.tierName ? (
              <span
                title="Categoría del cliente en el club"
                className="hidden items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium @3xl:flex"
                style={{
                  backgroundColor: loyalty.tierColor ? `${loyalty.tierColor}26` : undefined,
                  color: loyalty.tierColor ?? undefined,
                }}
              >
                {loyalty.tierName}
              </span>
            ) : null}
            {isWhatsApp ? (
              insideWindow ? (
                <span
                  title={
                    replyUntil
                      ? `El cliente escribió hace poco: podés responderle libre hasta ${replyUntil}.`
                      : 'Podés responder libre.'
                  }
                  className="hidden items-center gap-1 rounded-full bg-(--wa-accent-soft) px-2.5 py-1 text-xs font-medium text-(--wa-accent-deep) @2xl:flex"
                >
                  <Clock className="size-3" aria-hidden />
                  {replyUntil ? `Hasta ${replyUntil}` : 'Podés responder'}
                </span>
              ) : (
                <span
                  title="Pasaron más de 24 horas del último mensaje del cliente: para escribirle va un mensaje aprobado."
                  className="hidden items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning @2xl:flex"
                >
                  <BadgeCheck className="size-3" aria-hidden />
                  Con mensaje aprobado
                </span>
              )
            ) : null}
            {tagPicker}
          </div>
        </header>

        {thread}
        {composer}
      </div>

      {/* Drawer derecha: Info. del cliente */}
      {panelOpen ? (
        <aside
          aria-label="Información del cliente"
          className="absolute inset-0 z-20 flex flex-col bg-(--wa-app) animate-in fade-in slide-in-from-right-4 duration-200 md:static md:inset-auto md:w-[360px] md:shrink-0 md:border-l md:border-(--wa-border) xl:w-[400px]"
        >
          <header className="flex h-[59px] shrink-0 items-center gap-3 border-b border-(--wa-border) bg-(--wa-panel) px-4">
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label="Cerrar la ficha del cliente"
              className="flex size-9 items-center justify-center rounded-full text-(--wa-text-soft) transition-colors hover:bg-(--wa-hover)"
            >
              <X className="size-5" aria-hidden />
            </button>
            <h2 className="text-[15px] font-semibold text-(--wa-text)">Ficha del cliente</h2>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{contactPanel}</div>
        </aside>
      ) : null}
    </div>
  )
}
