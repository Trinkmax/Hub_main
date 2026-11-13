'use client'

import { ArrowRight, GraduationCap, LoaderCircle, ReceiptText } from 'lucide-react'
import { useId, useState } from 'react'
import { formatCentsShort } from '@/lib/money/format'
import { type CashPhase, SHIFT_LABELS, suggestShiftLabel, whenWords } from '@/lib/pos/cash/screen'
import { PesosInput, TypedGuard, useTypedAmount } from './typed'

/**
 * Abrir el turno es confirmar lo que dejó el anterior: «Dejaron $ 15.000 de cambio. ¿Están?». Un
 * toque si están; si no, se escribe cuánto hay (y queda anotada la diferencia). La primera vez de
 * una caja no hay nada que confirmar: se escribe con cuánto cambio arranca.
 */

export type OpenInput = { openingFloatCents: number; label: string | null; note: string | null }

const OTHER = '__otro__'

export function OpenShift({
  phase,
  now,
  timeZone,
  practice,
  manyRegisters,
  busy,
  children,
  onOpen,
  onSeeLast,
  onPractice,
}: {
  phase: Extract<CashPhase, { kind: 'first' | 'closed' }>
  /** La hora de la base. */
  now: string
  timeZone: string
  practice: boolean
  /** Hay más de una caja en la sucursal: se nombra cuál se abre. */
  manyRegisters: boolean
  busy: boolean
  /** La cinta del turno anterior (o lo que vaya a la derecha). */
  children?: React.ReactNode
  onOpen: (input: OpenInput) => void
  /** Ver cómo cerró el turno anterior. */
  onSeeLast?: () => void
  /** Entrar al carril de práctica. */
  onPractice?: () => void
}) {
  const last = phase.kind === 'closed' ? phase.last : null
  const expected = last?.leave_float_cents ?? null
  const [typing, setTyping] = useState(expected === null)
  const amount = useTypedAmount()
  const [label, setLabel] = useState<string>(() => suggestShiftLabel(now, timeZone))
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState('')
  const fieldId = useId()

  const registerName = phase.register?.name ?? 'la caja'
  const lastName = last?.label ? `el turno ${last.label}` : 'el turno anterior'
  const check = typing ? amount.check(expected !== null ? { referenceCents: expected } : {}) : null
  const cents = typing ? amount.cents : expected
  const differs = typing && expected !== null && cents !== null && cents !== expected
  const ready = cents !== null && (check === null || check.kind === 'ok')
  const chosenLabel = label === OTHER ? custom.trim() : label

  const submit = () => {
    if (!ready || busy || cents === null) return
    onOpen({
      openingFloatCents: cents,
      label: chosenLabel || null,
      note: differs && note.trim() ? note.trim() : null,
    })
  }

  return (
    <>
      <div className="caja-scroll">
        <form
          className="caja-open"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          {typing ? (
            <div className="caja-open-main">
              <h1 className="caja-ask">
                <label htmlFor={fieldId}>
                  {expected === null
                    ? `¿Con cuánto cambio arranca ${manyRegisters ? registerName : 'la caja'}?`
                    : '¿Cuánto hay en el cajón?'}
                </label>
              </h1>
              <div className="caja-hero-field">
                <span aria-hidden>$</span>
                <PesosInput
                  id={fieldId}
                  value={amount.text}
                  onChange={amount.setText}
                  disabled={busy}
                  data-testid="abrir-monto"
                />
              </div>
              <p className="caja-say">
                {expected === null ? (
                  <>
                    Es la primera vez que se abre. Contá lo que hay en el cajón y escribilo; si
                    arranca vacío, poné 0.
                  </>
                ) : (
                  <>
                    {capitalize(lastName)} dejó <b>{formatCentsShort(expected)}</b>. Escribí lo que
                    contaste: queda anotado junto con la diferencia.
                  </>
                )}
              </p>
              {check?.kind === 'ask' ? <TypedGuard ask={check} onPick={amount.set} /> : null}
            </div>
          ) : (
            <div className="caja-open-main">
              <p className="caja-hero" data-testid="abrir-esperado">
                <i>$</i>
                {formatCentsShort(expected ?? 0, { currency: false })}
              </p>
              <p className="caja-say">
                Es el cambio que dejó {lastName}
                {manyRegisters ? ` en ${registerName}` : ''}.
                {last?.closed_by_name
                  ? ` Lo cerró ${last.closed_by_name} ${whenWords(last.closed_at, now, timeZone)}.`
                  : ''}
              </p>
              <h1 className="caja-ask">¿Están en el cajón?</h1>
            </div>
          )}

          {differs ? (
            <div className="caja-set">
              <label htmlFor={`${fieldId}-nota`}>
                ¿Qué pasó? <small>si lo sabés</small>
              </label>
              <input
                id={`${fieldId}-nota`}
                className="caja-board-input"
                type="text"
                value={note}
                maxLength={300}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Faltaban dos billetes de mil"
                autoComplete="off"
                enterKeyHint="done"
              />
            </div>
          ) : null}

          <fieldset className="caja-set" disabled={busy}>
            <legend>
              Nombre del turno <small>si querés</small>
            </legend>
            <div className="caja-chips">
              {SHIFT_LABELS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="caja-chip"
                  aria-pressed={label === option}
                  onClick={() => setLabel(label === option ? '' : option)}
                >
                  {option}
                </button>
              ))}
              <button
                type="button"
                className="caja-chip"
                aria-pressed={label === OTHER}
                onClick={() => setLabel(label === OTHER ? '' : OTHER)}
              >
                Otro
              </button>
            </div>
            {label === OTHER ? (
              <input
                className="caja-board-input"
                type="text"
                value={custom}
                maxLength={30}
                onChange={(event) => setCustom(event.target.value)}
                placeholder="Evento, feriado, brunch"
                aria-label="Nombre del turno"
                autoComplete="off"
                autoCapitalize="sentences"
                enterKeyHint="done"
              />
            ) : null}
          </fieldset>

          {onSeeLast || onPractice ? (
            <div className="caja-links">
              {onSeeLast ? (
                <button type="button" className="caja-link" onClick={onSeeLast}>
                  <ReceiptText aria-hidden />
                  Ver cómo cerró {lastName}
                </button>
              ) : null}
              {onPractice && !practice ? (
                <button type="button" className="caja-link" onClick={onPractice}>
                  <GraduationCap aria-hidden />
                  Practicar sin tocar los números
                </button>
              ) : null}
            </div>
          ) : null}
        </form>
        {children}
      </div>

      <footer className="caja-bar">
        <div className="caja-actions">
          {expected !== null ? (
            <button
              type="button"
              className="caja-go is-quiet"
              onClick={() => setTyping((value) => !value)}
              disabled={busy}
              data-testid="abrir-otra"
            >
              {typing ? 'Volver' : 'No están'}
            </button>
          ) : null}
          <button
            type="button"
            className="caja-go"
            onClick={submit}
            disabled={!ready || busy}
            data-testid="abrir-turno"
          >
            {busy ? (
              <LoaderCircle className="caja-spin" aria-hidden />
            ) : ready ? (
              <ArrowRight aria-hidden strokeWidth={2.6} />
            ) : null}
            {!typing
              ? 'Sí, abrir el turno'
              : cents === null
                ? 'Escribí cuánto hay'
                : check?.kind === 'ask'
                  ? 'Elegí cuál es el monto'
                  : `Abrir con ${formatCentsShort(cents)}`}
          </button>
        </div>
      </footer>
    </>
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
