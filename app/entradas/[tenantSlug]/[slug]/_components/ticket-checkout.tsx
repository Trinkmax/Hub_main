'use client'

import { ArrowLeft, Lock, MessageCircle, Minus, Plus } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { buildWaMeUrl } from '@/lib/phone'
import { allSoldOut, maxSelectable } from '@/lib/ticketing/availability'
import { startCheckout } from '@/lib/ticketing/checkout-actions'
import { formatLongDate, formatShortDate } from '@/lib/ticketing/dates'
import { formatPesos, hasDepositOption, quote } from '@/lib/ticketing/pricing'
import type { PaymentOption } from '@/lib/ticketing/types'
import { cn } from '@/lib/utils'
import { RollNumber } from '../../../_components/roll-number'
import { useExperience } from './experience-context'
import { FunctionPicker } from './function-picker'

/**
 * «Tu entrada»: el ticket de papel donde se compra.
 *
 * Dos pasos, como dos caras de la entrada: primero se ARMA (qué noche,
 * cuántos van, seña o todo) con el total a la vista; después, a nombre de
 * quién. Partirlo así hace que en el celular no sea un formulario eterno y
 * que en la compu entre entero en la columna fija.
 *
 * Al pagar, el server guarda los lugares unos minutos y devuelve el link de
 * Mercado Pago: el navegador se va directo ahí (o a la app de Mercado Pago).
 */

type Step = 'build' | 'details'

type ExperienceInfo = {
  slug: string
  title: string
  priceCents: number
  depositCents: number
  maxPartySize: number
  terms: string | null
}

type VenueInfo = {
  tenantSlug: string
  tenantName: string
  canSell: boolean
  holdMinutes: number
  whatsapp: string | null
}

const GUEST_KEY = 'hub-entradas-guest'

function readGuest(): { name: string; phone: string } | null {
  try {
    const raw = window.localStorage.getItem(GUEST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { name?: unknown; phone?: unknown }
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      phone: typeof parsed.phone === 'string' ? parsed.phone : '',
    }
  } catch {
    return null
  }
}

function saveGuest(name: string, phone: string): void {
  try {
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ name, phone }))
  } catch {
    // Modo privado o almacenamiento bloqueado: no pasa nada, se vuelve a escribir.
  }
}

export function TicketCheckout({
  experience,
  venue,
  preview,
}: {
  experience: ExperienceInfo
  venue: VenueInfo
  preview: boolean
}) {
  const { functions, selected, reportSeats } = useExperience()
  const depositAvailable = hasDepositOption(experience.depositCents, experience.priceCents)

  const [step, setStep] = useState<Step>('build')
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd')
  const [party, setParty] = useState(2)
  const [option, setOption] = useState<PaymentOption>(depositAvailable ? 'deposit' : 'full')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState<string | undefined>(undefined)
  const [optIn, setOptIn] = useState(false)
  const [error, setError] = useState<{ message: string; field?: string } | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const [pending, startTransition] = useTransition()
  const stepRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const ids = useId()

  const max = selected ? maxSelectable(selected, experience.maxPartySize) : 0
  const people = Math.min(Math.max(1, party), Math.max(1, max))
  const q = quote({
    priceCents: experience.priceCents,
    depositCents: experience.depositCents,
    partySize: people,
    option,
  })

  // Lo que la persona escribió la vez anterior, en este celular.
  useEffect(() => {
    const guest = readGuest()
    if (!guest) return
    if (guest.name) setName(guest.name)
    if (guest.phone) setPhone(guest.phone)
  }, [])

  // Volver con «Atrás» desde Mercado Pago restaura la página congelada
  // (bfcache): sin esto quedaba «Abriendo Mercado Pago…» para siempre.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setRedirecting(false)
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  function goTo(next: Step, keepError: { message: string; field?: string } | null = null) {
    setDir(next === 'details' ? 'fwd' : 'back')
    setStep(next)
    setError(keepError)
    // El foco acompaña al paso (lectores de pantalla y teclado); en el de los
    // datos, directo al nombre si todavía no está escrito.
    requestAnimationFrame(() => {
      if (next === 'details' && name.trim().length < 2) {
        nameRef.current?.focus({ preventScroll: true })
        return
      }
      stepRef.current?.focus({ preventScroll: true })
    })
  }

  const soldOutAll = functions.length > 0 && allSoldOut(functions)
  const noFunctions = functions.length === 0
  const busy = pending || redirecting

  function waLink(text: string): string | null {
    return venue.whatsapp ? buildWaMeUrl(venue.whatsapp, text) : null
  }

  function submit() {
    if (!selected) {
      goTo('build', { message: 'Elegí una fecha.', field: 'event_id' })
      return
    }
    // El aviso aparece al lado del campo y el foco va ahí: con el ticket
    // largo, el campo vacío puede estar fuera de la pantalla.
    if (name.trim().length < 2) {
      setError({ message: 'Escribí el nombre de la reserva.', field: 'guest_name' })
      nameRef.current?.focus()
      return
    }
    if (!phone) {
      setError({ message: 'Dejanos tu WhatsApp.', field: 'guest_phone' })
      document.getElementById(`${ids}-phone`)?.focus()
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await startCheckout({
        tenant_slug: venue.tenantSlug,
        experience_slug: experience.slug,
        event_id: selected.eventId,
        party_size: people,
        option,
        guest_name: name,
        guest_phone: phone,
        marketing_opt_in: optIn,
        website: '',
      })
      if (result.ok) {
        saveGuest(name.trim(), phone)
        setRedirecting(true)
        window.location.assign(result.redirectUrl)
        return
      }
      if (result.seatsLeft !== undefined) reportSeats(selected.eventId, result.seatsLeft)
      const failure = { message: result.message, field: result.field }
      // Si el problema es de la fecha, las personas o la forma de pago, se
      // vuelve a la primera cara de la entrada con el aviso.
      if (result.field && ['event_id', 'party_size', 'option'].includes(result.field)) {
        goTo('build', failure)
      } else {
        setError(failure)
      }
    })
  }

  // ── Estados sin venta ─────────────────────────
  if (noFunctions || soldOutAll) {
    const wa = waLink(
      soldOutAll
        ? `¡Hola ${venue.tenantName}! Quería ir a ${experience.title} pero está agotado. ¿Me avisan si se libera un lugar o si suman fechas?`
        : `¡Hola ${venue.tenantName}! ¿Cuándo hay nuevas fechas de ${experience.title}?`,
    )
    return (
      <TicketShell title={experience.title} badge={soldOutAll ? 'Agotado' : 'Próximamente'}>
        <div className="relative px-5 py-8 text-center">
          {soldOutAll ? (
            <span className="ent-stamp ent-stamp-inline px-3 py-1 text-sm">Agotado</span>
          ) : null}
          <p className="ent-display mt-5 text-3xl text-balance">
            {soldOutAll ? 'Se agotaron todas las fechas.' : 'Muy pronto, nuevas fechas.'}
          </p>
          <p className="mx-auto mt-3 max-w-xs text-sm text-(--ent-ink-2)">
            {soldOutAll
              ? 'Escribinos y te avisamos si se libera un lugar o si sumamos funciones.'
              : 'Escribinos y te avisamos apenas abramos la venta.'}
          </p>
          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="ent-press mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-(--ent-ink) px-6 text-sm font-semibold text-(--ent-paper)"
            >
              <MessageCircle className="size-4" aria-hidden />
              Avisame por WhatsApp
            </a>
          ) : null}
          <Link
            href={`/entradas/${venue.tenantSlug}`}
            className="mt-4 block text-sm font-semibold text-(--ent-ink) underline underline-offset-4"
          >
            Ver otras películas
          </Link>
        </div>
      </TicketShell>
    )
  }

  const fieldError = (field: string) => (error?.field === field ? error.message : null)
  const generalError =
    error && !['guest_name', 'guest_phone'].includes(error.field ?? '') ? error.message : null

  const footer = (
    <>
      <div className="ent-ticket-cut px-5" aria-hidden>
        <hr className="ent-perforation" />
      </div>

      <div className="px-5 pt-5 pb-6">
        {venue.canSell ? (
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="ent-mono text-[0.6rem] text-(--ent-ink-2)">Hoy pagás</p>
              <RollNumber
                value={formatPesos(q.totalCents)}
                rank={q.totalCents}
                className="ent-display ent-num block text-[2.6rem] leading-none"
              />
            </div>
            <p className="max-w-[11rem] pb-1 text-right text-xs leading-snug text-(--ent-ink-2)">
              {q.option === 'deposit' ? (
                <>
                  Seña de {people} {people === 1 ? 'persona' : 'personas'}. En el bar:{' '}
                  <strong className="text-(--ent-ink)">{formatPesos(q.balanceCents)}</strong> en
                  efectivo.
                </>
              ) : (
                <>
                  Total de {people} {people === 1 ? 'persona' : 'personas'}. No pagás nada más.
                </>
              )}
            </p>
          </div>
        ) : null}

        {generalError ? (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-[#b42318]/10 px-3 py-2.5 text-sm font-semibold text-[#8f1c13]"
          >
            {generalError}
          </p>
        ) : null}

        {!venue.canSell ? (
          <WhatsappReserve
            href={waLink(
              selected
                ? `¡Hola ${venue.tenantName}! Quiero reservar para ${experience.title} el ${formatLongDate(selected.date)} a las ${selected.time}, somos ${people}.`
                : `¡Hola ${venue.tenantName}! Quiero reservar para ${experience.title}.`,
            )}
          />
        ) : step === 'build' ? (
          <button
            type="button"
            onClick={() =>
              selected
                ? goTo('details')
                : setError({ message: 'Elegí una fecha.', field: 'event_id' })
            }
            disabled={!selected || preview}
            className="ent-press mt-5 inline-flex h-14 w-full items-center justify-center rounded-2xl bg-(--ent-ink) text-base font-semibold text-(--ent-paper) disabled:opacity-50"
          >
            Continuar
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={busy || preview}
            className="ent-press ent-btn-pay mt-5 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold disabled:opacity-70"
          >
            <span
              className="ent-morph inline-flex items-center gap-2"
              data-busy={busy ? 'true' : 'false'}
            >
              {busy ? (
                <>
                  <span
                    className="ent-reel-spin inline-block size-4 rounded-full border-2 border-current border-t-transparent"
                    aria-hidden
                  />
                  {redirecting ? 'Abriendo Mercado Pago…' : 'Guardando tu lugar…'}
                </>
              ) : (
                <>
                  <Lock className="size-4" aria-hidden />
                  Pagar {formatPesos(q.totalCents)} con Mercado Pago
                </>
              )}
            </span>
          </button>
        )}

        {preview ? (
          <p className="mt-3 text-center text-xs font-semibold text-(--ent-ink-2)">
            Vista previa: publicá la película para vender.
          </p>
        ) : venue.canSell ? (
          <p className="mt-3 text-center text-xs leading-relaxed text-(--ent-ink-2)">
            {step === 'details'
              ? `Te guardamos ${people === 1 ? 'el lugar' : `los ${people} lugares`} ${venue.holdMinutes} minutos mientras pagás. Tarjeta, débito o dinero en cuenta.`
              : 'Pagás con Mercado Pago. Tu reserva queda hecha al instante.'}
          </p>
        ) : null}

        {experience.terms && step === 'details' ? (
          <p className="mt-3 border-t border-(--ent-ink)/10 pt-3 text-[0.7rem] leading-relaxed text-(--ent-ink-2)">
            {experience.terms}
          </p>
        ) : null}
      </div>
    </>
  )

  return (
    <TicketShell
      title={experience.title}
      badge={`Admite ${people}`}
      subtitle={selected ? `${formatShortDate(selected.date)} · ${selected.time} hs` : null}
      footer={footer}
    >
      <div
        ref={stepRef}
        tabIndex={-1}
        key={step}
        className="ent-step px-5 pt-5 pb-6 outline-none"
        data-dir={dir}
      >
        {step === 'build' ? (
          <div className="space-y-6 lg:space-y-5">
            <fieldset>
              <legend className="text-sm font-semibold">¿Qué noche?</legend>
              <FunctionPicker compact className="mt-3" />
            </fieldset>

            <fieldset>
              <legend className="text-sm font-semibold">¿Cuántos van?</legend>
              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  className="ent-stepper-btn"
                  onClick={() => setParty(Math.max(1, people - 1))}
                  disabled={people <= 1}
                  aria-label="Una persona menos"
                >
                  <Minus className="size-5" aria-hidden />
                </button>
                <div className="min-w-[4.5rem] text-center" aria-live="polite">
                  <RollNumber
                    value={String(people)}
                    rank={people}
                    className="ent-display ent-num block text-5xl leading-none"
                  />
                  <span className="ent-mono mt-1 block text-[0.58rem] text-(--ent-ink-2)">
                    {people === 1 ? 'persona' : 'personas'}
                  </span>
                </div>
                <button
                  type="button"
                  className="ent-stepper-btn"
                  onClick={() => setParty(Math.min(max, people + 1))}
                  disabled={people >= max}
                  aria-label="Una persona más"
                >
                  <Plus className="size-5" aria-hidden />
                </button>
                {selected?.state === 'last' ? (
                  <span className="ent-last ml-auto inline-flex items-center gap-1.5 text-xs font-semibold">
                    <span className="ent-pulse" aria-hidden />
                    {selected.left === 1 ? 'Queda 1 lugar' : `Quedan ${selected.left}`}
                  </span>
                ) : null}
              </div>
              {people >= max && max === experience.maxPartySize ? (
                <p className="mt-2 text-xs text-(--ent-ink-2)">
                  Para más de {experience.maxPartySize} personas, escribinos.
                </p>
              ) : null}
            </fieldset>

            {venue.canSell ? (
              <fieldset>
                <legend className="text-sm font-semibold">¿Cómo querés pagar?</legend>
                <div className="mt-3 grid gap-2.5">
                  {depositAvailable ? (
                    <OptionCard
                      name={`${ids}-option`}
                      checked={option === 'deposit'}
                      onSelect={() => setOption('deposit')}
                      title="Señá ahora"
                      amount={formatPesos(experience.depositCents)}
                      note={`El resto, ${formatPesos(experience.priceCents - experience.depositCents)} por persona, en efectivo en el bar.`}
                    />
                  ) : null}
                  <OptionCard
                    name={`${ids}-option`}
                    checked={option === 'full'}
                    onSelect={() => setOption('full')}
                    title="Pagá todo"
                    amount={formatPesos(experience.priceCents)}
                    note="Llegás y disfrutás: no pagás nada más."
                  />
                </div>
              </fieldset>
            ) : null}
          </div>
        ) : (
          <div className="space-y-5">
            <button
              type="button"
              onClick={() => goTo('build')}
              className="ent-press -ml-1 inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-(--ent-ink-2) hover:text-(--ent-ink)"
            >
              <ArrowLeft className="size-4" aria-hidden />
              {selected ? `${formatLongDate(selected.date)} · ${people}` : 'Cambiar'}
              {selected ? (people === 1 ? ' persona' : ' personas') : ''}
            </button>

            <div>
              <label htmlFor={`${ids}-name`} className="text-sm font-semibold">
                ¿A nombre de quién?
              </label>
              <input
                ref={nameRef}
                id={`${ids}-name`}
                className="ent-input mt-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Nombre y apellido"
                maxLength={120}
                aria-invalid={fieldError('guest_name') ? 'true' : undefined}
                aria-describedby={fieldError('guest_name') ? `${ids}-name-err` : undefined}
              />
              {fieldError('guest_name') ? (
                <p id={`${ids}-name-err`} className="mt-1.5 text-xs font-semibold text-[#b42318]">
                  {fieldError('guest_name')}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor={`${ids}-phone`} className="text-sm font-semibold">
                Tu WhatsApp
              </label>
              <div className="mt-2">
                <PhoneInput
                  id={`${ids}-phone`}
                  international
                  defaultCountry="AR"
                  value={phone}
                  onChange={setPhone}
                  placeholder="351 555 1234"
                  className="hub-phone-input"
                  aria-invalid={fieldError('guest_phone') ? 'true' : undefined}
                  aria-describedby={`${ids}-phone-help`}
                />
              </div>
              <p id={`${ids}-phone-help`} className="mt-1.5 text-xs text-(--ent-ink-2)">
                {fieldError('guest_phone') ? (
                  <span className="font-semibold text-[#b42318]">{fieldError('guest_phone')}</span>
                ) : (
                  'Por si tenemos que avisarte algo de la función.'
                )}
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-(--ent-paper-2)/60 p-3 text-sm">
              <input
                type="checkbox"
                checked={optIn}
                onChange={(e) => setOptIn(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-(--ent-ink)"
              />
              <span>
                Avisame por WhatsApp cuando haya nuevas películas.
                <span className="block text-xs text-(--ent-ink-2)">
                  Opcional. Podés darte de baja cuando quieras.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>
    </TicketShell>
  )
}

function TicketShell({
  title,
  badge,
  subtitle,
  footer,
  children,
}: {
  title: string
  badge: string
  subtitle?: string | null
  /** El total y el botón: en la compu quedan siempre a la vista. */
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  // En la compu la entrada va fija al costado y puede ser más alta que la
  // pantalla: el cuerpo scrollea adentro y el pie (total + botón) no se va
  // nunca. En el celular fluye entera, sin scroll propio.
  return (
    <div className="ent-form ent-paper flex flex-col overflow-hidden rounded-[22px] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)] lg:max-h-[calc(100dvh-10.5rem)]">
      <div
        className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 text-(--ent-paper)"
        style={{
          background:
            'linear-gradient(135deg, color-mix(in oklab, var(--accent) 88%, black), color-mix(in oklab, var(--accent) 60%, black))',
        }}
      >
        <div className="min-w-0">
          <p className="ent-mono text-[0.6rem] opacity-80">Tu entrada</p>
          <p className="ent-display mt-1 truncate text-2xl">{title}</p>
          {subtitle ? <p className="mt-1 text-xs font-medium opacity-85">{subtitle}</p> : null}
        </div>
        <span className="ent-mono shrink-0 rounded-md border border-current/40 px-2 py-1 text-[0.6rem]">
          {badge}
        </span>
      </div>
      <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:[mask-image:linear-gradient(to_bottom,#000_calc(100%-1.25rem),transparent)]">
        {children}
      </div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </div>
  )
}

function OptionCard({
  name,
  checked,
  onSelect,
  title,
  amount,
  note,
}: {
  name: string
  checked: boolean
  onSelect: () => void
  title: string
  amount: string
  note: string
}) {
  // Radio de verdad (teclado y lector de pantalla gratis), con la tarjeta
  // entera como etiqueta: la elegida va rellena.
  return (
    <label className="ent-option cursor-pointer" data-checked={checked ? 'true' : 'false'}>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{title}</span>
        <span className="ent-num text-lg font-semibold">
          {amount}
          <span
            className={cn(
              'ml-1 text-xs font-normal',
              checked ? 'opacity-75' : 'text-(--ent-ink-2)',
            )}
          >
            c/u
          </span>
        </span>
      </span>
      <span
        className={cn(
          'mt-1 block text-xs leading-snug',
          checked ? 'opacity-80' : 'text-(--ent-ink-2)',
        )}
      >
        {note}
      </span>
    </label>
  )
}

function WhatsappReserve({ href }: { href: string | null }) {
  if (!href) {
    return (
      <p className="mt-2 text-center text-sm text-(--ent-ink-2)">
        La venta online todavía no está abierta. Consultá en el bar.
      </p>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="ent-press mt-2 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-(--ent-ink) text-base font-semibold text-(--ent-paper)"
    >
      <MessageCircle className="size-4" aria-hidden />
      Reservar por WhatsApp
    </a>
  )
}
