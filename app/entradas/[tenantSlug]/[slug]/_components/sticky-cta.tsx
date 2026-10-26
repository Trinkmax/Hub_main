'use client'

import { Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatShortDate } from '@/lib/ticketing/dates'
import { formatPesos } from '@/lib/ticketing/pricing'
import { cn } from '@/lib/utils'
import { useExperience } from './experience-context'

/**
 * La barra fija del celular: la fecha elegida y «Reservar» siempre a un
 * pulgar, mientras se lee la historia. Aparece cuando el botón del principio
 * sale de pantalla y se esconde cuando la entrada ya está a la vista (no
 * tiene sentido tapar el ticket con un botón que lleva al ticket).
 */
export function StickyCta({ fromCents, soldOut }: { fromCents: number; soldOut: boolean }) {
  const { selected } = useExperience()
  const [heroGone, setHeroGone] = useState(false)
  const [ticketVisible, setTicketVisible] = useState(false)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const hero = document.getElementById('hero-cta')
    const ticket = document.getElementById('entrada')
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === hero) setHeroGone(!entry.isIntersecting)
        if (entry.target === ticket) setTicketVisible(entry.isIntersecting)
      }
    })
    if (hero) observer.observe(hero)
    if (ticket) observer.observe(ticket)
    return () => observer.disconnect()
  }, [])

  const show = heroGone && !ticketVisible

  const goToTicket = () => {
    const ticket = document.getElementById('entrada')
    if (!ticket) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ticket.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:hidden',
        show ? 'translate-y-0' : 'pointer-events-none translate-y-[115%]',
      )}
      aria-hidden={!show}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-(--ent-line-strong) bg-(--ent-bg-2)/95 p-2 pl-4 shadow-[0_-10px_40px_rgb(0_0_0/0.5)] backdrop-blur-md">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-(--ent-cream)">
            {soldOut
              ? 'Fechas agotadas'
              : selected
                ? `${formatShortDate(selected.date)} · ${selected.time} hs`
                : 'Elegí una fecha'}
          </p>
          {!soldOut ? (
            <p className="text-xs text-(--ent-muted)">Reservás con {formatPesos(fromCents)} c/u</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={goToTicket}
          tabIndex={show ? 0 : -1}
          className="ent-press inline-flex h-12 items-center gap-2 rounded-xl bg-(--ent-cream) px-5 text-sm font-semibold text-(--ent-ink)"
        >
          <Ticket className="size-4" aria-hidden />
          {soldOut ? 'Avisame' : 'Reservar'}
        </button>
      </div>
    </div>
  )
}
