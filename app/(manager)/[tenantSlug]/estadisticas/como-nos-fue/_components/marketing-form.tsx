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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  canonicalInput,
  type EventMarketingRow,
  type MarketingActionState,
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
  firstEmptyField,
  type KeptMarketingDraft,
  keepMarketingDraft,
  lastRateChipLabel,
  lastValidFromDraft,
  MARKETING_FIELD_ORDER,
  MARKETING_NUMBER_KINDS,
  MARKETING_UNREACHABLE,
  type MarketingDraft,
  marketingBaseline,
  marketingCopy,
  marketingRevenueVisible,
  type NumericMarketingField,
  nextLastValid,
  sameDraft,
} from '@/lib/salon/event-marketing-draft'
import { cn } from '@/lib/utils'
import { Disclosure } from './marketing-report'
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
 */

export type MarketingFormProps = {
  tenantSlug: string
  scheduledEventId: string
  eventTitle: string
  /** `YYYY-MM-DD`. */
  eventDate: string
  phase: MarketingPhase
  block: { reservations: number; guests: number }
  row: EventMarketingRow | null
  lastUsdArsRate: { rate: number; loadedAt: string } | null
  onSaved: (row: EventMarketingRow) => void
  onCancel: () => void
  onDeleted?: () => void
  /** Lo que se había escrito antes de cancelar. Sin él, el form abre con lo guardado. */
  initialDraft?: KeptMarketingDraft | null
  /** Justo antes de `onCancel`: lo escrito y su versión, o `null` si es igual a lo guardado. */
  onKeepDraft?: (kept: KeptMarketingDraft | null) => void
  className?: string
}

type FieldErrors = Partial<Record<MarketingField, string>>

const EYEBROW = 'text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground'

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
  const [draft, setDraft] = useState<MarketingDraft>(() => initialDraft?.draft ?? draftFromRow(row))
  const [lastValid, setLastValid] = useState(() =>
    lastValidFromDraft(initialDraft?.draft ?? draftFromRow(row)),
  )
  const [resumed, setResumed] = useState(
    () => initialDraft != null && !sameDraft(initialDraft.draft, draftFromRow(row)),
  )
  // La versión que el dueño tenía delante al abrir (la del borrador, si retoma
  // uno). Si la fila cambia debajo (otro dueño guardó y se refrescó, o guardó
  // mientras el borrador esperaba), se le muestra qué quedó guardado.
  const [baselineAt, setBaselineAt] = useState<string | null>(() =>
    marketingBaseline(initialDraft, row),
  )
  const [initialFocus] = useState(() =>
    firstEmptyField(initialDraft?.draft ?? draftFromRow(row), revenueVisible),
  )

  const [touched, setTouched] = useState<ReadonlySet<MarketingField>>(() => new Set())
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  const [srPreview, setSrPreview] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saving, startSaving] = useTransition()
  const [deleting, startDeleting] = useTransition()
  const pending = saving || deleting

  const formRef = useRef<HTMLFormElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const inputs = useRef<Partial<Record<MarketingField, HTMLInputElement | HTMLTextAreaElement>>>({})
  const focusRevenueOnMount = useRef(false)
  // Al confirmar el borrado el diálogo cierra en el mismo click que prende
  // `deleting`: «Borrar pauta» está apagado y `focus()` no hace nada. Se pide
  // acá y se cumple cuando termina (si falló; si salió bien, el form ya no está).
  const refocusDelete = useRef(false)

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
        if (field === 'revenueArs' && focusRevenueOnMount.current) {
          focusRevenueOnMount.current = false
          el.focus()
        }
      } else {
        delete inputs.current[field]
      }
    }

  useEffect(() => {
    inputs.current[initialFocus]?.focus()
  }, [initialFocus])

  useEffect(() => {
    if (pending || !refocusDelete.current) return
    refocusDelete.current = false
    // Un stale que trae la fila borrada desmonta el botón: el foco va al primer campo.
    ;(deleteButtonRef.current ?? inputs.current.adSpendUsd)?.focus()
  }, [pending])

  // ─── Derivados ──────────────────────────────────────────────────────────────

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

  const revenueOn = revenueVisible && draft.revenueOpen
  const lines = previewLines(block, {
    adSpendUsd: lastValid.adSpendUsd,
    messages: lastValid.messages,
    reach: lastValid.reach,
    revenueArs: revenueOn ? lastValid.revenueArs : null,
    usdArsRate: revenueOn ? lastValid.usdArsRate : null,
  })
  const previewText = lines.map((l) => l.text).join(' ')

  const changedUnderneath = (row?.updatedAt ?? null) !== baselineAt

  // ─── Edición ────────────────────────────────────────────────────────────────

  const setNumber = (field: NumericMarketingField, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }))
    setLastValid((prev) => ({
      ...prev,
      [field]: nextLastValid(prev[field], value, MARKETING_NUMBER_KINDS[field]),
    }))
    // Facturación y dólar se reclaman uno al otro: tocar cualquiera de los dos
    // invalida lo que el server dijo del par.
    const pair: MarketingField[] =
      field === 'revenueArs' || field === 'usdArsRate' ? ['revenueArs', 'usdArsRate'] : [field]
    setServerErrors((e) => withoutFields(e, pair))
  }

  const markTouched = (field: MarketingField) => {
    setTouched((t) => (t.has(field) ? t : new Set(t).add(field)))
    // El espejo para lector de pantalla se actualiza al salir del campo, no a
    // cada tecla: si no, lee tres renglones por cada dígito.
    setSrPreview(previewText)
  }

  const numberField = (field: NumericMarketingField) => ({
    id: fieldId(field),
    kind: MARKETING_NUMBER_KINDS[field],
    value: draft[field],
    onValueChange: (value: string) => setNumber(field, value),
    onBlur: () => markTouched(field),
    error: visibleErrors[field] ?? null,
    inputRef: register(field),
    disabled: pending,
  })

  const toggleRevenue = () => {
    if (draft.revenueOpen) {
      const pair: MarketingField[] = ['revenueArs', 'usdArsRate']
      setDraft((d) => ({ ...d, revenueOpen: false, revenueArs: '', usdArsRate: '' }))
      setLastValid((prev) => ({ ...prev, revenueArs: null, usdArsRate: null }))
      setServerErrors((e) => withoutFields(e, pair))
      setTouched((t) => new Set([...t].filter((f) => !pair.includes(f))))
      return
    }
    focusRevenueOnMount.current = true
    setDraft((d) => ({ ...d, revenueOpen: true }))
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
        // fecha que el server ya considera futura) tiene que decirse igual.
        const hidden = (fieldErrors.revenueArs || fieldErrors.usdArsRate) && !revenueOn
        if (hidden) toast.error(res.message)
        return
      }

      toast.error(res.message)
    })
  }

  const confirmDelete = () => {
    if (!row || pending) return
    const expected = row.updatedAt
    startDeleting(async () => {
      let res: MarketingActionState
      try {
        res = await deleteEventMarketing(tenantSlug, scheduledEventId, expected)
      } catch (error) {
        console.error(
          '[como-nos-fue.pauta.delete]',
          error instanceof Error ? error.message : 'sin respuesta',
        )
        toast.error(MARKETING_UNREACHABLE.delete)
        return
      }
      if (res.ok) {
        toast.success(copy.deletedToast)
        closed.current = true
        onDeleted?.()
        return
      }
      toast.error(res.message)
      if (res.code === 'stale') router.refresh()
    })
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
          <h4 className={EYEBROW}>Pauta en Meta</h4>
          <span className="hidden items-center gap-1 text-[11px] text-muted-foreground pointer-fine:inline-flex">
            <Kbd>Esc</Kbd> para cancelar
          </span>
        </div>

        {changedUnderneath ? (
          <div
            role="status"
            className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed"
          >
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
          </div>
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

        <Disclosure summary="¿Qué fechas filtro en Meta?" className="mt-2">
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
            hint="En Meta: «Importe gastado»"
          />
          <MoneyField
            {...numberField('messages')}
            label="Mensajes"
            currency={null}
            placeholder="0"
            hint="En Meta: «Conversaciones con mensajes iniciadas»"
          />
          <MoneyField
            {...numberField('reach')}
            label="Alcance"
            optional
            currency={null}
            placeholder="0"
            hint="En Meta: «Alcance»"
          />
        </div>

        {check.softWarning ? (
          <p className="mt-2 text-xs text-warning-text">{check.softWarning}</p>
        ) : null}

        <div className="mt-4 border-t border-border/50 pt-3">
          <p aria-hidden className={EYEBROW}>
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

        {revenueVisible ? (
          <div className="mt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 h-10 px-2 text-xs @sm:h-8"
              aria-expanded={draft.revenueOpen}
              aria-controls={`${uid}-revenue`}
              onClick={toggleRevenue}
              disabled={pending}
            >
              {draft.revenueOpen ? (
                <>
                  <X aria-hidden className="size-3.5" />
                  Quitar la facturación
                </>
              ) : (
                <>
                  <Plus aria-hidden className="size-3.5" />
                  Sumar la facturación del evento (opcional)
                </>
              )}
            </Button>
            {draft.revenueOpen ? (
              <div
                id={`${uid}-revenue`}
                className="mt-2 grid gap-x-4 gap-y-3 border-l border-border/60 pl-3 @md:grid-cols-2 @md:pl-4"
              >
                <MoneyField
                  {...numberField('revenueArs')}
                  label="Facturación del evento"
                  currency="ars"
                  placeholder="0"
                  hint="Solo lo del evento, sin las mesas normales de esa noche."
                />
                <MoneyField
                  {...numberField('usdArsRate')}
                  label="Dólar del día"
                  currency="ars"
                  placeholder="0"
                  hint="El que usaste para pagar Meta (el de la tarjeta)."
                >
                  {lastUsdArsRate && draft.usdArsRate.trim() === '' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-ml-2 h-7 justify-self-start px-2 text-xs tabular-nums pointer-coarse:h-10"
                      onClick={applyLastRate}
                      disabled={pending}
                    >
                      {lastRateChipLabel(lastUsdArsRate)}
                    </Button>
                  ) : null}
                </MoneyField>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={fieldId('notes')} className="gap-1 text-xs">
              Nota
              <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            {draft.notes.length >= 240 ? (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {draft.notes.length}/280
              </span>
            ) : null}
          </div>
          <Textarea
            ref={register('notes')}
            id={fieldId('notes')}
            rows={2}
            maxLength={280}
            placeholder="Ej.: campaña de reels del 1/9 al 9/9"
            value={draft.notes}
            disabled={pending}
            aria-invalid={notesError ? true : undefined}
            aria-describedby={notesError ? `${fieldId('notes')}-error` : undefined}
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
          {notesError ? (
            <p
              id={`${fieldId('notes')}-error`}
              role="alert"
              className="text-xs leading-snug text-destructive"
            >
              {notesError}
            </p>
          ) : null}
        </div>

        {/* Abajo de @sm: Guardar primero y a lo ancho (es lo que se busca con el
            pulgar), Cancelar abajo y Borrar como link al final. El orden del DOM
            es el de escritorio, que es donde se navega con Tab. */}
        <div className="mt-5 flex flex-col gap-2 @sm:flex-row @sm:items-center @sm:justify-end">
          {row ? (
            <Button
              ref={deleteButtonRef}
              type="button"
              variant="ghost"
              size="sm"
              className="order-last h-10 self-center text-destructive hover:text-destructive @sm:order-none @sm:mr-auto @sm:h-9 @sm:self-auto"
              onClick={() => setDeleteOpen(true)}
              disabled={pending}
            >
              {deleting ? 'Borrando…' : 'Borrar pauta'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="h-11 w-full @sm:h-9 @sm:w-auto"
            onClick={cancel}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            className="order-first h-11 w-full @sm:order-none @sm:h-9 @sm:w-auto"
            disabled={pending || blocked !== null}
          >
            {saving ? 'Guardando…' : 'Guardar pauta'}
          </Button>
        </div>
        <p aria-live="polite" className="mt-2 text-xs text-destructive empty:hidden @sm:text-right">
          {blocked ?? ''}
        </p>
      </form>

      {/* Fuera del <form>: así su Esc y sus botones no pasan por los handlers
          del form (React burbujea los eventos del portal por este árbol). */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            const button = deleteButtonRef.current
            if (button && !button.disabled) button.focus()
            else refocusDelete.current = true
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
