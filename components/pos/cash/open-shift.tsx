'use client'

import { ArrowRight, GraduationCap, LoaderCircle, ReceiptText, RotateCcw } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { formatCentsShort } from '@/lib/money/format'
import { type CashPhase, SHIFT_LABELS, suggestShiftLabel, whenWords } from '@/lib/pos/cash/screen'
import { PesosInput, TypedGuard, useTypedAmount } from './typed'

/**
 * Abrir el turno. La primera vez de una caja se escribe con cuánto cambio arranca.
 *
 * **Un socio** confirma lo que dejó el anterior: «Dejaron $ 15.000 de cambio. ¿Están?». Un toque si
 * están; si no, escribe cuánto hay (y queda anotada la diferencia).
 *
 * **Quien no es socio abre a ciegas** (`blind`): cuenta el cajón y escribe el total, sin ver cuánto dejó
 * el turno anterior (ese dato ni siquiera viaja a su pantalla). Así se hace un arqueo: si la pantalla
 * le dice cuánto tiene que haber, no hace falta contar. Para que un fajo mal contado no sea una falsa
 * alarma se le pregunta UNA cosa al servidor (`onCheck`: ¿coincide?, sí o no) y, si no coincide, se pide
 * contar una vez más, sin decir cuánto ni para qué lado. La diferencia les llega a los socios.
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
  blind = false,
  children,
  onOpen,
  onCheck,
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
  /** Quien abre no ve los números del salón: cuenta el cajón sin saber cuánto dejó el turno anterior. */
  blind?: boolean
  /** A ciegas: ¿lo contado es lo que dejó el turno anterior? `null` = no se pudo preguntar. */
  onCheck?: (countedCents: number) => Promise<boolean | null>
  /** La cinta del turno anterior (o lo que vaya a la derecha). */
  children?: React.ReactNode
  onOpen: (input: OpenInput) => void
  /** Ver cómo cerró el turno anterior. */
  onSeeLast?: () => void
  /** Entrar al carril de práctica. */
  onPractice?: () => void
}) {
  const last = phase.kind === 'closed' ? phase.last : null
  // A ciegas no hay «esperado»: no viaja, y aunque viajara no se usa.
  const expected = blind ? null : (last?.leave_float_cents ?? null)
  // Hay un turno anterior contra el que el servidor puede comparar lo que se cuente.
  const blindCount = blind && last !== null
  const [typing, setTyping] = useState(expected === null)
  const amount = useTypedAmount()
  // A ciegas: ya se preguntó una vez si coincide (no se vuelve a preguntar) y dijo que no.
  const asked = useRef(false)
  const [checking, setChecking] = useState(false)
  const [recount, setRecount] = useState(false)
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

  const send = (openingFloatCents: number) =>
    onOpen({
      openingFloatCents,
      label: chosenLabel || null,
      note: (differs || recount) && note.trim() ? note.trim() : null,
    })
  const submit = () => {
    if (!ready || busy || checking || cents === null) return
    // A ciegas: una sola pregunta al servidor, y solo la primera vez.
    if (blindCount && onCheck && !asked.current) {
      setChecking(true)
      void onCheck(cents).then((matches) => {
        setChecking(false)
        if (matches === false) {
          asked.current = true
          setRecount(true)
        } else send(cents)
      })
      return
    }
    send(cents)
  }
  const working = busy || checking

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
                  {blindCount
                    ? `¿Cuánto hay en ${manyRegisters ? registerName : 'el cajón'}?`
                    : expected === null
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
                  disabled={working}
                  data-testid="abrir-monto"
                />
              </div>
              <p className="caja-say">
                {blindCount ? (
                  <>
                    Contá los billetes y escribí el total: queda anotado con tu nombre.
                    {last?.closed_by_name
                      ? ` El turno anterior lo cerró ${last.closed_by_name} ${whenWords(last.closed_at, now, timeZone)}.`
                      : ''}
                  </>
                ) : expected === null ? (
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
              {recount ? (
                <div className="caja-open-recount" role="status" data-testid="abrir-recuento">
                  <b>
                    <RotateCcw aria-hidden strokeWidth={2.6} />
                    No coincide: contá una vez más
                  </b>
                  <p>
                    Lo que contaste no es lo que dejó el turno anterior. Casi siempre es un fajo
                    pasado de largo o un billete de más: pasalos de nuevo y corregí el número si
                    hace falta. Si ya está bien contado, abrí igual: la diferencia la revisan los
                    socios.
                  </p>
                </div>
              ) : null}
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

          {differs || recount ? (
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

          <fieldset className="caja-set" disabled={working}>
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
              disabled={working}
              data-testid="abrir-otra"
            >
              {typing ? 'Volver' : 'No están'}
            </button>
          ) : null}
          <button
            type="button"
            className="caja-go"
            onClick={submit}
            disabled={!ready || working}
            data-testid="abrir-turno"
          >
            {working ? (
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
