'use client'

import { ArrowLeft, ArrowRight, Lock, MessageCircle, Minus, Plus } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { buildWaMeUrl } from '@/lib/phone'
import { allSoldOut, maxSelectable } from '@/lib/ticketing/availability'
import { startCheckout } from '@/lib/ticketing/checkout-actions'
import { formatLongDate, formatShortDate } from '@/lib/ticketing/dates'
import { readLastOrder, saveLastOrder } from '@/lib/ticketing/last-order'
import {
  balanceCashOnly,
  cashPrice,
  formatPesos,
  paymentOptions,
  quote,
} from '@/lib/ticketing/pricing'
import { splitTerms } from '@/lib/ticketing/terms'
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
 * quién, con las condiciones justo antes de pagar. Partirlo así hace que en el celular no sea un formulario eterno y
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
  /** Total por persona señando y pagando el resto en efectivo; null = priceCents. */
  cashPriceCents: number | null
  /** Si se puede pagar todo online; si no, se reserva solo con seña. */
  allowFullPayment: boolean
  minPartySize: number
  maxPartySize: number
  /** Aclara el precio: «Incluye todos los pasos de la película». */
  priceNote: string | null
  terms: string | null
}

type VenueInfo = {
  tenantSlug: string
  tenantName: string
  canSell: boolean
  holdMinutes: number
  whatsapp: string | null
  /** El bar cargó un alias: si Mercado Pago rechaza, se puede transferir. */
  canTransfer: boolean
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
  const available = paymentOptions(experience)
  const depositAvailable = available.deposit
  // Solo seña (HUB desde el 30/10): no hay nada que elegir, la entrada dice
  // el precio, la seña de hoy y lo que queda para el día del evento.
  const depositOnly = available.deposit && !available.full
  // Con precio en efectivo propio, el resto es solo en efectivo; con un solo
  // precio, se paga como quiera.
  const cashOnly = balanceCashOnly(experience.cashPriceCents)
  // Cine y degustación no se vende para una sola persona: el mínimo es de la
  // película (la base lo vuelve a controlar al guardar el lugar).
  const minParty = Math.max(1, experience.minPartySize)

  const [step, setStep] = useState<Step>('build')
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd')
  const [party, setParty] = useState(() => Math.max(2, minParty))
  const [option, setOption] = useState<PaymentOption>(depositAvailable ? 'deposit' : 'full')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState<string | undefined>(undefined)
  const [error, setError] = useState<{ message: string; field?: string } | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  // Volvió de Mercado Pago a esta página: su compra sigue ahí, con la forma de transferir.
  const [lastOrderId, setLastOrderId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const stepRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const ids = useId()

  const max = selected ? maxSelectable(selected, experience.maxPartySize) : 0
  const people = Math.min(Math.max(minParty, party), Math.max(minParty, max))
  const q = quote({
    priceCents: experience.priceCents,
    depositCents: experience.depositCents,
    cashPriceCents: experience.cashPriceCents,
    partySize: people,
    option,
  })
  // En efectivo puede salir menos que con Mercado Pago (HUB hasta noviembre:
  // $30.000 contra $35.000 por persona): la seña se paga hoy y el resto en el
  // bar. Sin precio en efectivo es el mismo precio.
  const cashCents = cashPrice(experience.priceCents, experience.cashPriceCents)
  const restPerPerson = formatPesos(Math.max(0, cashCents - experience.depositCents))

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

  useEffect(() => {
    const read = () => setLastOrderId(readLastOrder(experience.slug))
    read()
    window.addEventListener('pageshow', read)
    return () => window.removeEventListener('pageshow', read)
  }, [experience.slug])

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
        website: '',
      })
      if (result.ok) {
        saveGuest(name.trim(), phone)
        saveLastOrder(experience.slug, result.orderId)
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

  // Con precio en efectivo, las dos formas de pago se eligen por CÓMO se paga
  // el resto (pedido de los socios del 27/10): el saldo en el bar es solo en
  // efectivo, así que quien quiere pagar con tarjeta paga todo ahora. Con un
  // solo precio (pedido del 30/10), seña o todo junto. Cada tarjeta dice lo
  // que sale por persona de esa forma; el pie, lo de hoy y lo que queda.
  const optionCards = (compact: boolean) => (
    <div className={cn('grid gap-2.5', compact ? depositAvailable && 'grid-cols-2' : 'mt-3')}>
      {depositAvailable ? (
        <OptionCard
          name={`${ids}-option${compact ? '-c' : ''}`}
          compact={compact}
          checked={option === 'deposit'}
          onSelect={() => setOption('deposit')}
          title={cashOnly ? '¿Pagás en efectivo?' : 'Reservá con seña'}
          amount={formatPesos(cashCents)}
          detail={`Hoy, seña de ${formatPesos(experience.depositCents)}`}
          note={
            cashOnly
              ? `Hoy señás ${formatPesos(experience.depositCents)} por persona y los ${restPerPerson} restantes, en efectivo en el bar.`
              : `Hoy señás ${formatPesos(experience.depositCents)} por persona y el día del evento, en el local, pagás lo restante (${restPerPerson}).`
          }
        />
      ) : null}
      <OptionCard
        name={`${ids}-option${compact ? '-c' : ''}`}
        compact={compact}
        checked={option === 'full'}
        onSelect={() => setOption('full')}
        title={
          !depositAvailable
            ? 'Pagás todo con Mercado Pago'
            : cashOnly
              ? '¿Pagás con Mercado Pago?'
              : 'Pagá todo ahora'
        }
        amount={formatPesos(experience.priceCents)}
        detail="Todo junto, hoy"
        note="Pagás todo junto ahora, con tarjeta, débito o dinero en cuenta."
      />
    </div>
  )

  // Solo seña: la tarjeta del precio, con el texto que pidieron los socios
  // («Precio por persona: $45.000, incluye todos los pasos de la película.
  // Para reservar…»). En el celular la aclaración del precio va acá y no
  // junto al total; en la compu va la versión corta en el pie (en el cuerpo
  // se cortaba con el scroll de adentro) y la aclaración, junto al total.
  const priceCard = (compact: boolean) => (
    <PriceCard
      compact={compact}
      title="Precio por persona"
      amount={formatPesos(cashCents)}
      detail={`Hoy, seña de ${formatPesos(experience.depositCents)}`}
      note={`${experience.priceNote ? `${experience.priceNote} ` : ''}Para reservar, pagás una seña de ${formatPesos(experience.depositCents)} por persona. El día del evento, en el local, pagás lo restante (${restPerPerson} por persona${cashOnly ? ', en efectivo' : ''}).`}
    />
  )

  // Las condiciones (en HUB: la seña no tiene devolución), legibles y antes
  // de pagar, no en letra chica debajo del botón: pidieron que quede todo
  // claro antes de comprar.
  const termsLine = experience.terms ? splitTerms(experience.terms) : null
  const termsBox = experience.terms ? (
    <div className="rounded-xl border border-(--ent-ink)/15 bg-(--ent-ink)/[0.04] px-3.5 py-3">
      <p className="ent-mono text-[0.6rem] text-(--ent-ink-2)">Antes de pagar</p>
      <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-(--ent-ink) lg:mt-1 lg:text-[0.7rem] lg:leading-snug">
        {experience.terms}
      </p>
    </div>
  ) : null

  const footer = (
    <>
      <div className="ent-ticket-cut px-5" aria-hidden>
        <hr className="ent-perforation" />
      </div>

      <div className="px-5 pt-5 pb-6">
        {venue.canSell && step === 'build' && depositOnly ? (
          <div className="mb-5 hidden lg:block">{priceCard(true)}</div>
        ) : venue.canSell && step === 'build' ? (
          // En la compu la forma de pago va acá, al lado del total que cambia:
          // la entrada fija puede ser más alta que la pantalla y «Pagá todo»
          // quedaba escondido en el scroll de adentro. Lo que explicaba cada
          // tarjeta lo dice el texto del total. En el celular va arriba.
          // Debajo de la perforación las dos tarjetas se explican solas: el
          // título queda para el lector de pantalla y la entrada entra entera
          // en una notebook de 1440×900 (~790 px de ventana).
          <fieldset className="mb-5 hidden lg:block">
            <legend className="sr-only">¿Cómo querés pagar?</legend>
            {optionCards(true)}
          </fieldset>
        ) : null}

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
              {q.option === 'deposit' && cashOnly ? (
                <>
                  Seña de {people} {people === 1 ? 'persona' : 'personas'}. En el bar:{' '}
                  <strong className="text-(--ent-ink)">{formatPesos(q.balanceCents)}</strong> en
                  efectivo.
                </>
              ) : q.option === 'deposit' ? (
                <>
                  Seña de {people} {people === 1 ? 'persona' : 'personas'}. El día del evento:{' '}
                  <strong className="text-(--ent-ink)">{formatPesos(q.balanceCents)}</strong>.
                </>
              ) : (
                <>
                  Total de {people} {people === 1 ? 'persona' : 'personas'}.
                </>
              )}
              {/* La aclaración del precio; con solo seña, en el celular va en la
                  tarjeta. */}
              {experience.priceNote ? (
                <span className={depositOnly ? 'hidden lg:inline' : undefined}>
                  {' '}
                  {experience.priceNote}
                </span>
              ) : null}
            </p>
          </div>
        ) : null}

        {venue.canSell && step === 'build' && termsLine ? (
          // En la compu la entrada fija no tiene lugar para las condiciones
          // enteras junto al precio: va la primera frase y el resto se
          // despliega. En el celular van enteras en el cuerpo.
          <details className="group mt-4 hidden rounded-xl border border-(--ent-ink)/15 bg-(--ent-ink)/[0.04] px-3.5 py-2 text-[0.72rem] leading-snug lg:block">
            <summary className="cursor-pointer list-none text-(--ent-ink) [&::-webkit-details-marker]:hidden">
              <span className="font-semibold">{termsLine.first}</span>
              {termsLine.rest ? (
                <span className="text-(--ent-ink-2) underline underline-offset-2 group-open:hidden">
                  {' '}
                  Ver más
                </span>
              ) : null}
            </summary>
            {termsLine.rest ? (
              <p className="mt-1 whitespace-pre-line text-(--ent-ink)">{termsLine.rest}</p>
            ) : null}
          </details>
        ) : null}

        {generalError ? (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-[#b42318]/10 px-3 py-2.5 text-sm font-semibold text-[#8f1c13]"
          >
            {generalError}
          </p>
        ) : null}

        {experience.terms && step === 'details' && venue.canSell ? (
          // En el celular, justo antes del botón de pagar (la entrada fluye
          // con la página y se lee entera). En la compu van en el cuerpo,
          // arriba de los datos: en el pie tapaban el campo del WhatsApp.
          <div className="mt-4 lg:hidden">{termsBox}</div>
        ) : null}

        {venue.canSell && venue.canTransfer && lastOrderId ? (
          <Link
            href={`/entradas/${venue.tenantSlug}/mi-entrada/${lastOrderId}`}
            className="ent-press mt-4 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-(--ent-ink)/25 px-3.5 py-2 text-sm font-semibold text-(--ent-ink)"
          >
            ¿Mercado Pago no te dejó pagar? Ver cómo transferir
            <ArrowRight className="size-4 shrink-0" aria-hidden />
          </Link>
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
            {step === 'details' ? (
              <>
                Te guardamos {people === 1 ? 'el lugar' : `los ${people} lugares`}{' '}
                {venue.holdMinutes} minutos mientras pagás.
                {/* En la compu, un renglón menos: la entrada fija es baja. */}
                <span className="lg:hidden"> Tarjeta, débito o dinero en cuenta.</span>
              </>
            ) : (
              'Pagás con Mercado Pago. Tu reserva queda hecha al instante.'
            )}
          </p>
        ) : null}
        {!preview && venue.canSell && venue.canTransfer && step === 'details' ? (
          <p className="mt-1.5 text-center text-xs leading-relaxed text-(--ent-ink-2)">
            Si Mercado Pago te rechaza el pago, volvé a esta página: te mostramos cómo transferir.
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

            {/* Fieldset nombrado por aria-labelledby y no por legend: en la
                compu va en un renglón (pregunta a la izquierda, contador a la
                derecha) y una legend no se acomoda en una fila flex. */}
            <fieldset aria-labelledby={`${ids}-party`}>
              <div className="lg:flex lg:items-center lg:justify-between lg:gap-4">
                <div className="flex items-center justify-between gap-3 lg:block">
                  <p id={`${ids}-party`} className="text-sm font-semibold">
                    ¿Cuántos van?
                  </p>
                  {selected?.state === 'last' ? (
                    <span className="ent-last inline-flex items-center gap-1.5 text-xs font-semibold lg:mt-1">
                      <span className="ent-pulse" aria-hidden />
                      {selected.left === 1 ? 'Queda 1 lugar' : `Quedan ${selected.left}`}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center gap-4 lg:mt-0 lg:gap-2">
                  <button
                    type="button"
                    className="ent-stepper-btn lg:size-10"
                    onClick={() => setParty(Math.max(minParty, people - 1))}
                    disabled={people <= minParty}
                    aria-label="Una persona menos"
                  >
                    <Minus className="size-5" aria-hidden />
                  </button>
                  <div className="min-w-[4.5rem] text-center lg:min-w-[3.25rem]" aria-live="polite">
                    <RollNumber
                      value={String(people)}
                      rank={people}
                      className="ent-display ent-num block text-5xl leading-none lg:text-4xl"
                    />
                    <span className="ent-mono mt-1 block text-[0.58rem] text-(--ent-ink-2)">
                      {people === 1 ? 'persona' : 'personas'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="ent-stepper-btn lg:size-10"
                    onClick={() => setParty(Math.min(max, people + 1))}
                    disabled={people >= max}
                    aria-label="Una persona más"
                  >
                    <Plus className="size-5" aria-hidden />
                  </button>
                </div>
              </div>
              {people >= max && max === experience.maxPartySize ? (
                <p className="mt-2 text-xs text-(--ent-ink-2)">
                  Para más de {experience.maxPartySize} personas, escribinos.
                </p>
              ) : minParty > 1 && people <= minParty ? (
                <p className="mt-2 text-xs text-(--ent-ink-2)">
                  Se reserva desde {minParty} personas.
                </p>
              ) : null}
            </fieldset>

            {venue.canSell && depositOnly ? (
              <div className="lg:hidden">
                <p className="text-sm font-semibold">¿Cuánto sale?</p>
                <div className="mt-3">{priceCard(false)}</div>
              </div>
            ) : venue.canSell ? (
              <fieldset className="lg:hidden">
                <legend className="text-sm font-semibold">¿Cómo querés pagar?</legend>
                {optionCards(false)}
              </fieldset>
            ) : null}

            {/* Las condiciones también acá, junto al precio y antes de «Continuar»
                (pedido de los socios, 02/11: «le falta la aclaración de las
                señas»). En la compu van en el pie, ver `termsLine`. En el paso
                2 se repiten enteras, justo antes de pagar. */}
            {venue.canSell && termsBox ? <div className="lg:hidden">{termsBox}</div> : null}
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

            {/* En la compu, arriba de los datos: abajo quedaban detrás del pie
                fijo y se podía pagar sin verlas. */}
            {venue.canSell && termsBox ? <div className="hidden lg:block">{termsBox}</div> : null}

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
  // En la compu, si la pantalla da, la entrada va fija al costado
  // (.ent-ticket-col en entradas.css): si igual es más alta que la pantalla,
  // el cuerpo scrollea adentro y el pie (forma de pago + total + botón) no se
  // va nunca. En el celular y en notebooks bajas fluye entera.
  return (
    <div className="ent-form ent-paper flex flex-col overflow-hidden rounded-[22px] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)]">
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
      <div className="ent-ticket-body">{children}</div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </div>
  )
}

function OptionCard({
  name,
  compact = false,
  checked,
  onSelect,
  title,
  amount,
  detail,
  note,
}: {
  name: string
  /** La versión de la compu, de a dos en un renglón y sin la explicación. */
  compact?: boolean
  checked: boolean
  onSelect: () => void
  /** La pregunta: «¿Pagás en efectivo?». */
  title: string
  /** Lo que sale por persona pagando de esa forma. */
  amount: string
  /** Debajo del monto, en la versión de la compu: «Hoy, seña de $5.000». */
  detail: string
  /** La explicación entera, en la del celular. */
  note: string
}) {
  // Radio de verdad (teclado y lector de pantalla gratis), con la tarjeta
  // entera como etiqueta: la elegida va rellena.
  const unit = (
    <span className={cn('ml-1 text-xs font-normal', checked ? 'opacity-75' : 'text-(--ent-ink-2)')}>
      c/u
    </span>
  )
  if (compact) {
    return (
      // Columna con el monto abajo: si una pregunta ocupa dos renglones y la
      // otra uno, los montos quedan igual a la misma altura.
      <label
        className="ent-option ent-option-compact flex cursor-pointer flex-col justify-between gap-1"
        data-checked={checked ? 'true' : 'false'}
      >
        <input
          type="radio"
          name={name}
          checked={checked}
          onChange={onSelect}
          className="peer sr-only"
        />
        <span className="block text-sm leading-snug font-semibold text-balance">{title}</span>
        <span className="block">
          <span className="ent-num block text-base font-semibold">
            {amount}
            {unit}
          </span>
          <span
            className={cn('block text-[0.7rem]', checked ? 'opacity-75' : 'text-(--ent-ink-2)')}
          >
            {detail}
          </span>
        </span>
      </label>
    )
  }
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
        <span className="font-semibold text-balance">{title}</span>
        <span className="ent-num shrink-0 text-lg font-semibold">
          {amount}
          {unit}
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

/** La misma tarjeta, sin nada que elegir: cuando la película se reserva solo con seña. */
function PriceCard({
  compact = false,
  title,
  amount,
  detail,
  note,
}: {
  /** La versión de la compu, en un renglón y sin la explicación. */
  compact?: boolean
  title: string
  amount: string
  /** Debajo del monto, en la versión de la compu: «Hoy, seña de $20.000». */
  detail: string
  /** La explicación entera, en la del celular. */
  note: string
}) {
  if (compact) {
    return (
      <div
        className="ent-option ent-option-compact ent-option-static flex items-center justify-between gap-3"
        data-checked="false"
      >
        <span className="text-sm leading-snug font-semibold">{title}</span>
        <span className="text-right">
          <span className="ent-num block text-base font-semibold">
            {amount}
            <span className="ml-1 text-xs font-normal text-(--ent-ink-2)">c/u</span>
          </span>
          <span className="block text-[0.7rem] text-(--ent-ink-2)">{detail}</span>
        </span>
      </div>
    )
  }
  return (
    <div className="ent-option ent-option-static" data-checked="false">
      <p className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-balance">{title}</span>
        <span className="ent-num shrink-0 text-lg font-semibold">
          {amount}
          <span className="ml-1 text-xs font-normal text-(--ent-ink-2)">c/u</span>
        </span>
      </p>
      <p className="mt-1 text-xs leading-snug text-(--ent-ink-2)">{note}</p>
    </div>
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
