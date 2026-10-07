'use client'

import { Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { Disclosure } from '@/components/ui/disclosure'
import { Field } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import {
  canonicalInput,
  type EventMarketingRow,
  type MarketingActionState,
  type MarketingBlock,
  type MarketingField,
  type MarketingPhase,
  marketingSentence,
  previewLines,
} from '@/lib/salon/event-marketing'
import { deleteEventMarketing, saveEventMarketing } from '@/lib/salon/event-marketing-actions'
import {
  blockedSaveMessage,
  checkMarketingDraft,
  draftFromRow,
  draftIsNoAds,
  firstEmptyField,
  type KeptMarketingDraft,
  keepMarketingDraft,
  lastRateChipLabel,
  lastValidFromDraft,
  MARKETING_FIELD_LABELS,
  MARKETING_FIELD_ORDER,
  MARKETING_MONEY_FIELDS,
  MARKETING_MONEY_HINTS,
  MARKETING_NO_ADS_HINTS,
  MARKETING_NUMBER_KINDS,
  MARKETING_UNREACHABLE,
  type MarketingDraft,
  marketingBaseline,
  marketingCopy,
  marketingFieldEnabled,
  marketingRevenueVisible,
  missingRateNotice,
  type NumericMarketingField,
  nextLastValid,
  sameDraft,
  withoutMoney,
} from '@/lib/salon/event-marketing-draft'
import { cn } from '@/lib/utils'
import { MoneyField, scrollIntoViewOnTouch } from './money-field'

/**
 * Cargar la pauta de una fecha, en línea, en el lugar de la sección: los tres
 * números de gente quedan a la vista arriba, que es contra lo que se divide.
 *
 * Decisiones que no se ven:
 *
 * - **No es optimista.** La validación puede fallar y la vuelta es de menos de
 *   un segundo: mostrar números guardados que después rebotan es peor que un
 *   «Guardando…». Lo único optimista de la pauta es «No tuvo pauta», que es un
 *   click y tiene Deshacer (vive en la sección, no acá).
 * - **Los errores aparecen al salir del campo o al guardar**, nunca mientras se
 *   tipea: «No entendí el número» en la mitad de `1.2` es un reto, no una ayuda.
 * - **El chequeo es el del server** (`checkMarketingDraft` corre el mismo schema
 *   zod), así un error del server cae en el mismo campo y con las mismas
 *   palabras que uno del cliente.
 * - **Nada se pre-llena en silencio.** El último dólar se ofrece como chip; un
 *   dólar viejo guardado sin mirar movería el retorno un 30-60 %.
 * - **Otro dueño guardó en el medio** (stale): el form queda abierto con lo que
 *   se tipeó, la página se refresca y arriba se muestra lo que quedó guardado.
 *   El `updated_at` nuevo pasa a ser la base del próximo guardado.
 *
 * Esc cancela sin preguntar: lo tipeado queda en la sección mientras esté
 * montada (`initialDraft` / `onKeepDraft`), junto con la versión contra la que
 * se escribió: si al reabrir la fila es otra, se avisa como en el stale. Sin
 * localStorage ni diálogo.
 *
 * Borrar pide confirmación con el `ConfirmDialog` del kit: espera al server con
 * el diálogo abierto («Borrando…») y, si falla, el error queda adentro.
 */

/**
 * A dónde vuelve el foco cuando el diálogo de borrar se cierra porque el form
 * ya se desmontó (borrado con éxito): a donde lo haya puesto la sección (el
 * «Cargar pauta» de la ficha, el «Editar» de la fila del mes). Si nadie lo
 * movió, el diálogo lo lleva al título de la página.
 */
function focusWherePageLeftIt(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

export type MarketingFormProps = {
  tenantSlug: string
  scheduledEventId: string
  eventTitle: string
  /** `YYYY-MM-DD`. */
  eventDate: string
  phase: MarketingPhase
  /** La gente de la fecha, incluida `billableGuests`: la que multiplica la plata. */
  block: MarketingBlock
  row: EventMarketingRow | null
  lastUsdArsRate: { rate: number; loadedAt: string } | null
  onSaved: (row: EventMarketingRow) => void
  onCancel: () => void
  onDeleted?: () => void
  /** Lo que se había escrito antes de cancelar. Sin él, el form abre con lo guardado. */
  initialDraft?: KeptMarketingDraft | null
  /** Justo antes de `onCancel`: lo escrito y su versión, o `null` si es igual a lo guardado. */
  onKeepDraft?: (kept: KeptMarketingDraft | null) => void
  /**
   * Abre con «la plata de la noche» desplegada y el foco en su primer campo
   * vacío («Gastado» antes, si está vacío): es a lo que se viene desde el botón
   * de «La cuenta de la noche» (02/10).
   */
  openMoney?: boolean
  className?: string
}

type FieldErrors = Partial<Record<MarketingField, string>>

function withoutFields<T>(source: Partial<Record<MarketingField, T>>, fields: MarketingField[]) {
  const next = { ...source }
  for (const f of fields) delete next[f]
  return next
}

export function MarketingForm({
  tenantSlug,
  scheduledEventId,
  eventTitle,
  eventDate,
  phase,
  block,
  row,
  lastUsdArsRate,
  onSaved,
  onCancel,
  onDeleted,
  initialDraft,
  onKeepDraft,
  openMoney = false,
  className,
}: MarketingFormProps) {
  const router = useRouter()
  const uid = useId()
  const fieldId = (field: MarketingField) => `${uid}-${field}`
  const copy = marketingCopy(eventTitle, eventDate)

  // Una fecha que todavía no pasó no facturó nada: la sección ni se ofrece,
  // salvo que la fila ya traiga facturación (no se borra a escondidas).
  const revenueVisible = marketingRevenueVisible(phase, row)

  const saved = useMemo(() => draftFromRow(row), [row])
  // Un borrador retomado manda (es lo que el dueño dejó escrito); si no, lo
  // guardado. Venir desde «Sumar la plata» abre esa sección en los dos casos.
  const [opening] = useState<MarketingDraft>(() => {
    const base = initialDraft ? initialDraft.draft : draftFromRow(row)
    return openMoney ? { ...base, moneyOpen: true } : base
  })
  const [draft, setDraft] = useState<MarketingDraft>(opening)
  const [lastValid, setLastValid] = useState(() => lastValidFromDraft(opening))
  const [resumed, setResumed] = useState(
    () => initialDraft != null && !sameDraft(initialDraft.draft, draftFromRow(row)),
  )
  // La versión que el dueño tenía delante al abrir (la del borrador, si retoma
  // uno). Si la fila cambia debajo (otro dueño guardó y se refrescó, o guardó
  // mientras el borrador esperaba), se le muestra qué quedó guardado.
  const [baselineAt, setBaselineAt] = useState<string | null>(() =>
    marketingBaseline(initialDraft, row),
  )
  // Desde «La cuenta de la noche» el foco va a la plata (no a «Alcance»).
  const [initialFocus] = useState(() => firstEmptyField(opening, revenueVisible, openMoney))

  const [touched, setTouched] = useState<ReadonlySet<MarketingField>>(() => new Set())
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  const [srPreview, setSrPreview] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saving, startSaving] = useTransition()
  // Borrar espera adentro del diálogo (modal): mientras tanto el form no se toca.
  const pending = saving

  const formRef = useRef<HTMLFormElement>(null)
  const inputs = useRef<Partial<Record<MarketingField, HTMLInputElement | HTMLTextAreaElement>>>({})
  // Al abrir la sección de plata el foco va a su primer campo, que se monta en
  // el mismo render: se pide acá y lo cumple el `ref` cuando aparece.
  const focusMoneyOnMount = useRef(false)

  // Si el form se desmonta SIN cerrarse (rotar el teléfono y pasar de tarjeta a
  // tabla, la fila que cambia de lugar después de un refresh, abrir otro
  // «Editar»), lo escrito se entrega igual que en «Cancelar», con su versión:
  // al volver a montarse retoma y, si la fila cambió, muestra lo que quedó
  // guardado. `closed` lo apagan Cancelar, Guardar y Borrar, que ya resolvieron.
  const closed = useRef(false)
  const latest = useRef({ draft, saved, baselineAt, onKeepDraft })
  useEffect(() => {
    latest.current = { draft, saved, baselineAt, onKeepDraft }
  })
  useEffect(
    () => () => {
      if (closed.current) return
      const l = latest.current
      l.onKeepDraft?.(keepMarketingDraft(l.draft, l.saved, l.baselineAt))
    },
    [],
  )

  const register =
    (field: MarketingField) => (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (el) {
        inputs.current[field] = el
        if (field === 'revenuePerGuestArs' && focusMoneyOnMount.current) {
          focusMoneyOnMount.current = false
          el.focus()
        }
      } else {
        delete inputs.current[field]
      }
    }

  useEffect(() => {
    inputs.current[initialFocus]?.focus()
  }, [initialFocus])

  // ─── Derivados ──────────────────────────────────────────────────────────────

  // «Gastado» en 0: la noche no tuvo pauta. Lo de Meta y el dólar se apagan en
  // su lugar (esconderlos movería el form a cada tecla mientras se tipea
  // `0,50`) y se muestran vacíos: lo escrito sigue en el borrador y vuelve si
  // el 0 era un error, pero no viaja ni se ve como si se fuera a guardar.
  const noAds = draftIsNoAds(draft)

  const check = checkMarketingDraft(draft, {
    scheduledEventId,
    expectedUpdatedAt: row?.updatedAt ?? null,
    revenueVisible,
  })

  const visibleErrors: FieldErrors = {}
  for (const field of MARKETING_FIELD_ORDER) {
    const shown =
      serverErrors[field] ??
      (submitted || touched.has(field) ? check.fieldErrors[field] : undefined)
    if (shown) visibleErrors[field] = shown
  }
  const blocked = blockedSaveMessage(visibleErrors)

  // Solo los campos que están A LA VISTA entran en la vista previa: si no, la
  // cuenta mostraría plata de una sección cerrada que además no se va a guardar.
  const onScreen = (field: NumericMarketingField) =>
    marketingFieldEnabled(field, draft, revenueVisible) ? lastValid[field] : null
  // La fase va también acá: la previa de una fecha que todavía no pasó tiene
  // que hablar como la ficha después de guardar («Por ahora …»).
  const lines = previewLines(
    block,
    {
      adSpendUsd: lastValid.adSpendUsd,
      messages: lastValid.messages,
      reach: lastValid.reach,
      revenuePerGuestArs: onScreen('revenuePerGuestArs'),
      costPerGuestArs: onScreen('costPerGuestArs'),
      drinkRevenuePerGuestArs: onScreen('drinkRevenuePerGuestArs'),
      drinkCostPerGuestArs: onScreen('drinkCostPerGuestArs'),
      revenueArs: onScreen('revenueArs'),
      usdArsRate: onScreen('usdArsRate'),
    },
    phase,
  )
  const previewText = lines.map((l) => l.text).join(' ')
  // No bloquea: el dólar falta para el retorno, pero la carga entra igual. Sin
  // pauta no hay retorno que calcular, y el dólar está apagado.
  const rateNotice = noAds
    ? null
    : missingRateNotice({
        revenueArs: onScreen('revenueArs'),
        usdArsRate: onScreen('usdArsRate'),
      })

  const changedUnderneath = (row?.updatedAt ?? null) !== baselineAt

  // ─── Edición ────────────────────────────────────────────────────────────────

  const setNumber = (field: NumericMarketingField, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }))
    setLastValid((prev) => ({
      ...prev,
      [field]: nextLastValid(prev[field], value, MARKETING_NUMBER_KINDS[field]),
    }))
    // Cada campo entra solo (ya no hay pares): tocar uno borra lo que el server
    // dijo de ESE campo y nada más.
    setServerErrors((e) => withoutFields(e, [field]))
  }

  const markTouched = (field: MarketingField) => {
    setTouched((t) => (t.has(field) ? t : new Set(t).add(field)))
    // El espejo para lector de pantalla se actualiza al salir del campo, no a
    // cada tecla: si no, lee tres renglones por cada dígito.
    setSrPreview(previewText)
  }

  const numberField = (field: NumericMarketingField) => {
    const off = noAds && !marketingFieldEnabled(field, draft, revenueVisible)
    return {
      id: fieldId(field),
      kind: MARKETING_NUMBER_KINDS[field],
      value: off ? '' : draft[field],
      onValueChange: (value: string) => setNumber(field, value),
      onBlur: () => markTouched(field),
      error: off ? null : (visibleErrors[field] ?? null),
      inputRef: register(field),
      disabled: pending || off,
      ...(off ? { placeholder: '—' } : {}),
    }
  }

  /** La ayuda de un campo de Meta: de dónde sale, o por qué está apagado. */
  const metaHint = (field: 'messages' | 'reach' | 'usdArsRate', normal: string) =>
    noAds ? MARKETING_NO_ADS_HINTS[field] : normal

  const toggleMoney = () => {
    if (draft.moneyOpen) {
      // Cerrar la sección es borrar sus seis números: lo que no se ve no se
      // guarda, y dejarlos escritos por detrás terminaba guardando plata que el
      // dueño creía haber sacado.
      const money = [...MARKETING_MONEY_FIELDS]
      setDraft(withoutMoney)
      setLastValid((prev) => {
        const next = { ...prev }
        for (const field of money) next[field] = null
        return next
      })
      setServerErrors((e) => withoutFields(e, money))
      setTouched((t) => new Set([...t].filter((f) => !money.some((m) => m === f))))
      return
    }
    focusMoneyOnMount.current = true
    setDraft((d) => ({ ...d, moneyOpen: true }))
  }

  const applyLastRate = () => {
    if (!lastUsdArsRate) return
    setNumber('usdArsRate', canonicalInput(lastUsdArsRate.rate, 'rate'))
    // El chip desaparece al llenarse el campo: el foco va al campo, no al vacío.
    inputs.current.usdArsRate?.focus()
  }

  const backToSaved = () => {
    const next = draftFromRow(row)
    setDraft(next)
    setLastValid(lastValidFromDraft(next))
    setResumed(false)
    setBaselineAt(row?.updatedAt ?? null)
    setServerErrors({})
    setTouched(new Set())
    setSubmitted(false)
  }

  const cancel = () => {
    if (pending) return
    closed.current = true
    onKeepDraft?.(keepMarketingDraft(draft, saved, baselineAt))
    onCancel()
  }

  // ─── Guardar y borrar ───────────────────────────────────────────────────────

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (pending) return
    setSubmitted(true)
    setSrPreview(previewText)
    const input = check.input
    if (!input || blocked) {
      const first = MARKETING_FIELD_ORDER.find((f) => check.fieldErrors[f] ?? serverErrors[f])
      if (first) inputs.current[first]?.focus()
      return
    }

    startSaving(async () => {
      let res: MarketingActionState
      try {
        res = await saveEventMarketing(tenantSlug, input)
      } catch (error) {
        console.error(
          '[como-nos-fue.pauta.save]',
          error instanceof Error ? error.message : 'sin respuesta',
        )
        toast.error(MARKETING_UNREACHABLE.save)
        return
      }

      if (res.ok) {
        if (!res.row) {
          toast.error(MARKETING_UNREACHABLE.save)
          return
        }
        toast.success(copy.savedToast)
        closed.current = true
        onSaved(res.row)
        return
      }

      if (res.code === 'stale') {
        toast.error(res.message)
        router.refresh()
        return
      }

      const fieldErrors = res.fieldErrors ?? {}
      if (res.code === 'invalid' && Object.keys(fieldErrors).length > 0) {
        setServerErrors(fieldErrors)
        // Un error en un campo que no está a la vista (la facturación de una
        // fecha que el server ya considera futura) tiene que decirse igual: si
        // no, el guardado falla y no hay nada rojo en ningún lado.
        const hidden = MARKETING_FIELD_ORDER.some(
          (f) =>
            fieldErrors[f] !== undefined &&
            f !== 'notes' &&
            !marketingFieldEnabled(f, draft, revenueVisible),
        )
        if (hidden) toast.error(res.message)
        return
      }

      toast.error(res.message)
    })
  }

  /** Lo corre el `ConfirmDialog`: si falla, el diálogo queda abierto con el error. */
  const confirmDelete = async (): Promise<ConfirmResult> => {
    if (!row) return
    const expected = row.updatedAt
    let res: MarketingActionState
    try {
      res = await deleteEventMarketing(tenantSlug, scheduledEventId, expected)
    } catch (error) {
      console.error(
        '[como-nos-fue.pauta.delete]',
        error instanceof Error ? error.message : 'sin respuesta',
      )
      return { ok: false, error: MARKETING_UNREACHABLE.delete }
    }
    if (res.ok) {
      toast.success(copy.deletedToast)
      closed.current = true
      onDeleted?.()
      return
    }
    if (res.code === 'stale') router.refresh()
    return res
  }

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
    // Solo lo que pasa DENTRO del form: React hace burbujear los eventos de los
    // portales (un Select, un diálogo) por su árbol, y ese Esc no es nuestro.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
    event.preventDefault()
    cancel()
  }

  const notesError = visibleErrors.notes ?? null

  return (
    <div className={cn('@container', className)}>
      <form
        ref={formRef}
        noValidate
        aria-label={copy.formLabel}
        onSubmit={submit}
        onKeyDown={onFormKeyDown}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="type-label text-muted-foreground">Pauta en Meta</h4>
          <span className="hidden items-center gap-1 type-caption text-muted-foreground pointer-fine:inline-flex">
            <Kbd>Esc</Kbd> para cancelar
          </span>
        </div>

        {changedUnderneath ? (
          <Callout tone="warning" announce="polite" className="mt-3">
            {row ? (
              <>
                <span className="text-foreground">
                  Lo que quedó guardado: {marketingSentence(block, row, phase)}
                </span>{' '}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={backToSaved}
                >
                  Volver a lo guardado
                </Button>
              </>
            ) : (
              <span className="text-foreground">
                Otro dueño borró esta pauta recién. Si guardás, se carga de nuevo.
              </span>
            )}
          </Callout>
        ) : resumed ? (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            Seguís con lo que habías escrito.{' '}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs"
              onClick={backToSaved}
            >
              Volver a lo guardado
            </Button>
          </p>
        ) : null}

        <Disclosure variant="inline" title="¿Qué fechas filtro en Meta?" className="mt-2">
          <p className="max-w-prose text-muted-foreground">
            Filtrá la campaña de esta fecha, desde que arrancó hasta el día del evento.
          </p>
        </Disclosure>

        <div className="mt-3 grid gap-x-4 gap-y-3 @xl:grid-cols-3">
          <MoneyField
            {...numberField('adSpendUsd')}
            label="Gastado"
            currency="usd"
            placeholder="0,00"
            hint={
              noAds
                ? 'Sin pauta: la noche va sin gasto en Meta.'
                : 'En Meta: «Importe gastado». Si no hubo pauta, 0.'
            }
          />
          <MoneyField
            placeholder="0"
            {...numberField('messages')}
            label="Mensajes"
            currency={null}
            hint={metaHint('messages', 'En Meta: «Conversaciones con mensajes iniciadas»')}
          />
          <MoneyField
            placeholder="0"
            {...numberField('reach')}
            label="Alcance"
            optional
            currency={null}
            hint={metaHint('reach', 'En Meta: «Alcance»')}
          />
        </div>

        {check.softWarning ? (
          <p className="mt-2 text-xs text-warning-text">{check.softWarning}</p>
        ) : null}

        {/* La plata de la noche, en un desplegable: son seis números que no
            se cargan todas las veces, y abiertos de entrada empujaban la pauta
            —que es lo que casi siempre se viene a cargar— fuera de la pantalla. */}
        <div className="mt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2"
            aria-expanded={draft.moneyOpen}
            aria-controls={`${uid}-money`}
            onClick={toggleMoney}
            disabled={pending}
          >
            {draft.moneyOpen ? (
              <>
                <X aria-hidden />
                Quitar la plata
              </>
            ) : (
              <>
                <Plus aria-hidden />
                Sumar la plata de la noche (opcional)
              </>
            )}
          </Button>
          {draft.moneyOpen ? (
            <div
              id={`${uid}-money`}
              className="mt-2 grid gap-x-4 gap-y-3 border-l border-border pl-3 @md:grid-cols-2 @md:pl-4"
            >
              {/* Ninguno lleva «(opcional)»: opcional es la sección entera, y
                  seis veces la misma aclaración tapa las ayudas, que son las
                  que de verdad dicen qué va en cada campo. */}
              <MoneyField
                {...numberField('revenuePerGuestArs')}
                label="Ingreso por persona"
                currency="ars"
                placeholder="0"
                hint={MARKETING_MONEY_HINTS.revenuePerGuestArs}
              />
              <MoneyField
                {...numberField('costPerGuestArs')}
                label="Costo por persona"
                currency="ars"
                placeholder="0"
                hint={MARKETING_MONEY_HINTS.costPerGuestArs}
              />
              {/* La bebida, sin placeholder: un «0» gris se leería como «bebida
                  incluida», que es un dato y no un vacío. */}
              <MoneyField
                {...numberField('drinkRevenuePerGuestArs')}
                label={MARKETING_FIELD_LABELS.drinkRevenuePerGuestArs}
                currency="ars"
                hint={MARKETING_MONEY_HINTS.drinkRevenuePerGuestArs}
              />
              <MoneyField
                {...numberField('drinkCostPerGuestArs')}
                label={MARKETING_FIELD_LABELS.drinkCostPerGuestArs}
                currency="ars"
                hint={MARKETING_MONEY_HINTS.drinkCostPerGuestArs}
              />
              {revenueVisible ? (
                <MoneyField
                  {...numberField('revenueArs')}
                  label="Facturación del evento"
                  currency="ars"
                  placeholder="0"
                  hint={MARKETING_MONEY_HINTS.revenueArs}
                />
              ) : null}
              <MoneyField
                placeholder="0"
                {...numberField('usdArsRate')}
                label="Dólar del día"
                currency="ars"
                hint={metaHint('usdArsRate', MARKETING_MONEY_HINTS.usdArsRate)}
              >
                {lastUsdArsRate && !noAds && draft.usdArsRate.trim() === '' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 justify-self-start tabular-nums"
                    onClick={applyLastRate}
                    disabled={pending}
                  >
                    {lastRateChipLabel(lastUsdArsRate)}
                  </Button>
                ) : null}
                {/* Aviso, no error: sin el dólar no hay retorno, pero se guarda igual. */}
                {rateNotice ? <p className="type-caption text-warning-text">{rateNotice}</p> : null}
              </MoneyField>
            </div>
          ) : null}
        </div>

        {/* La vista previa va ÚLTIMA de los números: es el resumen de todo lo
            que se acaba de tipear, incluida la cuenta de la noche. */}
        <div className="mt-4 border-t border-border pt-3">
          <p aria-hidden className="type-label text-muted-foreground">
            Con estos números
          </p>
          <ul
            aria-hidden
            className="mt-1.5 space-y-0.5 text-xs leading-relaxed text-muted-foreground"
          >
            {lines.map((line) => {
              // Lo que se está calculando va primero y en tinta; la cuenta, en gris.
              const cut = line.text.indexOf(' · ')
              return (
                <li key={line.text} className="tabular-nums">
                  <span className="font-medium text-foreground">
                    {cut === -1 ? line.text : line.text.slice(0, cut)}
                  </span>
                  {cut === -1 ? null : line.text.slice(cut)}
                </li>
              )
            })}
          </ul>
          <p className="sr-only" aria-live="polite">
            {srPreview}
          </p>
        </div>

        <Field
          id={fieldId('notes')}
          label="Nota"
          optional
          error={notesError}
          // El contador aparece cerca del tope, no antes: antes sería ruido.
          hint={
            draft.notes.length >= 240 ? (
              <span className="tabular-nums">{draft.notes.length}/280</span>
            ) : undefined
          }
          disabled={pending}
          className="mt-4"
        >
          <Textarea
            ref={register('notes')}
            rows={2}
            maxLength={280}
            placeholder="Ej.: campaña de reels del 1/9 al 9/9"
            value={draft.notes}
            onChange={(e) => {
              const value = e.target.value
              setDraft((d) => ({ ...d, notes: value }))
              setServerErrors((errs) => withoutFields(errs, ['notes']))
            }}
            onBlur={() => markTouched('notes')}
            onFocus={scrollIntoViewOnTouch}
            onKeyDown={(e) => {
              // Enter en la nota es un renglón nuevo; ⌘/Ctrl+Enter guarda.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                formRef.current?.requestSubmit()
              }
            }}
          />
        </Field>

        {/* Las acciones del kit, en línea (no fijas abajo: el form vive adentro
            de una ficha y puede haber más de uno en la pantalla). En el celular
            van de a dos, del mismo ancho, y «Guardar» queda solo abajo, a mano
            del pulgar; en escritorio, «Borrar» a la izquierda. */}
        <FormActions sticky={false} className="mt-5">
          {row ? (
            <Button
              type="button"
              variant="danger-ghost"
              onClick={() => setDeleteOpen(true)}
              disabled={pending}
              className="sm:me-auto"
            >
              Borrar pauta
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={cancel} disabled={pending}>
            Cancelar
          </Button>
          <Button
            type="submit"
            loading={saving}
            loadingText="Guardando…"
            disabled={blocked !== null}
          >
            Guardar pauta
          </Button>
        </FormActions>
        <p
          aria-live="polite"
          className="mt-2 type-caption text-destructive-text empty:hidden @sm:text-right"
        >
          {blocked ?? ''}
        </p>
      </form>

      {/* Fuera del <form>: así su Esc y sus botones no pasan por los handlers
          del form (React burbujea los eventos del portal por este árbol). */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title={copy.deleteTitle}
        description={copy.deleteDescription}
        confirmLabel="Borrar pauta"
        pendingLabel="Borrando…"
        onConfirm={confirmDelete}
        returnFocus={focusWherePageLeftIt}
      />
    </div>
  )
}
