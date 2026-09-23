'use client'

import { useRouter } from 'next/navigation'
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
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
  deleteBirthdayMarketing,
  saveBirthdayMarketing,
} from '@/lib/salon/birthday-marketing-actions'
import {
  BIRTHDAY_FIELD_ORDER,
  BIRTHDAY_MARKETING_UNREACHABLE,
  BIRTHDAY_NUMBER_KINDS,
  type BirthdayMarketingActionState,
  type BirthdayMarketingDraft,
  type BirthdayMarketingField,
  birthdayDraftFromRow,
  blockedBirthdaySaveMessage,
  checkBirthdayMarketingDraft,
} from '@/lib/salon/birthday-marketing-schemas'
import {
  type BirthdayMarketingRow,
  type BirthdayMonthPhase,
  type BookedSummary,
  birthdayPautaReport,
} from '@/lib/salon/birthdays-report'
import { formatCount } from '@/lib/salon/event-marketing'
import { cn } from '@/lib/utils'
import { MoneyField, scrollIntoViewOnTouch } from './money-field'

/**
 * Cargar la pauta de cumpleaños de un mes, en línea, en el lugar de la sección.
 *
 * Mismas decisiones que el formulario de la pauta de eventos
 * (`marketing-form.tsx`): no es optimista (la validación puede fallar y la
 * vuelta es corta), los errores aparecen al salir del campo o al guardar, el
 * chequeo es el MISMO schema del server, y si otro dueño guardó en el medio el
 * form queda abierto con lo tipeado y la página se refresca.
 *
 * La vista previa usa la MISMA cuenta que la pestaña (`birthdayPautaReport`),
 * contra los cumples reservados en el mes: lo que se ve acá es lo que se va a
 * ver al guardar.
 */

type FieldErrors = Partial<Record<BirthdayMarketingField, string>>

const EYEBROW = 'text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground'

export function BirthdayMarketingForm({
  tenantSlug,
  ym,
  monthName,
  phase,
  booked,
  row,
  onSaved,
  onCancel,
  onDeleted,
}: {
  tenantSlug: string
  /** `YYYY-MM`. */
  ym: string
  /** `'septiembre'`, para los textos. */
  monthName: string
  phase: BirthdayMonthPhase
  /** Los cumples reservados en el mes: contra esto se calcula la vista previa. */
  booked: BookedSummary
  row: BirthdayMarketingRow | null
  onSaved: (row: BirthdayMarketingRow) => void
  onCancel: () => void
  onDeleted: () => void
}) {
  const router = useRouter()
  const uid = useId()
  const fieldId = (field: BirthdayMarketingField) => `${uid}-${field}`

  const [draft, setDraft] = useState<BirthdayMarketingDraft>(() => birthdayDraftFromRow(row))
  const [touched, setTouched] = useState<ReadonlySet<BirthdayMarketingField>>(() => new Set())
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saving, startSaving] = useTransition()
  const [deleting, startDeleting] = useTransition()
  const pending = saving || deleting

  const inputs = useRef<
    Partial<Record<BirthdayMarketingField, HTMLInputElement | HTMLTextAreaElement>>
  >({})
  const register =
    (field: BirthdayMarketingField) => (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (el) inputs.current[field] = el
      else delete inputs.current[field]
    }

  // El foco va al primer número vacío (casi siempre «Mensajes» al actualizar).
  const [initialFocus] = useState<BirthdayMarketingField>(
    () =>
      (['adSpendUsd', 'messages', 'reach'] as const).find((f) => draft[f].trim() === '') ??
      'adSpendUsd',
  )
  useEffect(() => {
    inputs.current[initialFocus]?.focus()
  }, [initialFocus])

  const check = checkBirthdayMarketingDraft(draft, {
    ym,
    expectedUpdatedAt: row?.updatedAt ?? null,
  })

  const visibleErrors: FieldErrors = {}
  for (const field of BIRTHDAY_FIELD_ORDER) {
    const shown =
      serverErrors[field] ??
      (submitted || touched.has(field) ? check.fieldErrors[field] : undefined)
    if (shown) visibleErrors[field] = shown
  }
  const blocked = blockedBirthdaySaveMessage(visibleErrors)

  // La vista previa: la misma cuenta que la pestaña, con lo último que se lee.
  const spend = check.values.adSpendUsd
  const preview =
    spend !== null && Math.round(spend * 100) >= 1
      ? birthdayPautaReport(
          booked,
          { adSpendUsd: spend, messages: check.values.messages, reach: check.values.reach },
          phase,
        )
      : null

  const setField = (field: BirthdayMarketingField, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }))
    setServerErrors((e) => {
      const next = { ...e }
      delete next[field]
      return next
    })
  }

  const markTouched = (field: BirthdayMarketingField) =>
    setTouched((t) => (t.has(field) ? t : new Set(t).add(field)))

  const numberField = (field: Exclude<BirthdayMarketingField, 'notes'>) => ({
    id: fieldId(field),
    kind: BIRTHDAY_NUMBER_KINDS[field],
    value: draft[field],
    onValueChange: (value: string) => setField(field, value),
    onBlur: () => markTouched(field),
    error: visibleErrors[field] ?? null,
    inputRef: register(field),
    disabled: pending,
  })

  const cancel = () => {
    if (!pending) onCancel()
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (pending) return
    setSubmitted(true)
    const input = check.input
    if (!input || blocked) {
      const first = BIRTHDAY_FIELD_ORDER.find((f) => check.fieldErrors[f] ?? serverErrors[f])
      if (first) inputs.current[first]?.focus()
      return
    }
    startSaving(async () => {
      let res: BirthdayMarketingActionState
      try {
        res = await saveBirthdayMarketing(tenantSlug, input)
      } catch (error) {
        console.error(
          '[como-nos-fue.cumples.save]',
          error instanceof Error ? error.message : 'sin respuesta',
        )
        toast.error(BIRTHDAY_MARKETING_UNREACHABLE.save)
        return
      }
      if (res.ok) {
        if (!res.row) {
          toast.error(BIRTHDAY_MARKETING_UNREACHABLE.save)
          return
        }
        toast.success(`Pauta de cumpleaños de ${monthName} guardada.`)
        onSaved(res.row)
        return
      }
      if (res.code === 'stale') {
        toast.error(res.message)
        router.refresh()
        return
      }
      if (res.code === 'invalid' && res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
        setServerErrors(res.fieldErrors)
        return
      }
      toast.error(res.message)
    })
  }

  const confirmDelete = () => {
    if (!row || pending) return
    const expected = row.updatedAt
    startDeleting(async () => {
      let res: BirthdayMarketingActionState
      try {
        res = await deleteBirthdayMarketing(tenantSlug, ym, expected)
      } catch (error) {
        console.error(
          '[como-nos-fue.cumples.delete]',
          error instanceof Error ? error.message : 'sin respuesta',
        )
        toast.error(BIRTHDAY_MARKETING_UNREACHABLE.delete)
        return
      }
      if (res.ok) {
        toast.success(`Pauta de cumpleaños de ${monthName} borrada.`)
        onDeleted()
        return
      }
      toast.error(res.message)
      if (res.code === 'stale') router.refresh()
    })
  }

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
    event.preventDefault()
    cancel()
  }

  const notesError = visibleErrors.notes ?? null

  return (
    <div className="@container">
      <form
        noValidate
        aria-label={`Pauta de cumpleaños de ${monthName}`}
        onSubmit={submit}
        onKeyDown={onFormKeyDown}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={EYEBROW}>Pauta de cumpleaños</h3>
          <span className="hidden items-center gap-1 text-[11px] text-muted-foreground pointer-fine:inline-flex">
            <Kbd>Esc</Kbd> para cancelar
          </span>
        </div>
        <p className="mt-1.5 max-w-prose text-xs text-muted-foreground">
          En Meta, filtrá la campaña de cumpleaños del 1 al último día de {monthName}.
        </p>

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

        {/* La vista previa: la misma cuenta que va a quedar en la pestaña. */}
        <div className="mt-4 border-t border-border/50 pt-3">
          <p aria-hidden className={EYEBROW}>
            Con estos números
          </p>
          {preview ? (
            <div aria-hidden className="mt-1.5 space-y-1 text-xs leading-relaxed">
              <p className="tabular-nums text-muted-foreground">
                {preview.tiles.map((t, i) => (
                  <span key={t.key}>
                    {i > 0 ? ' · ' : null}
                    <span className={cn('font-medium', t.value ? 'text-foreground' : undefined)}>
                      {t.value ?? '—'}
                    </span>{' '}
                    {t.label.toLowerCase()}
                  </span>
                ))}
              </p>
              <p className="text-muted-foreground">
                {booked.birthdays === 0
                  ? `Todavía no hay cumples reservados en ${monthName}.`
                  : booked.birthdays === 1
                    ? `Contra el cumple reservado en ${monthName}.`
                    : `Contra los ${formatCount(booked.birthdays)} cumples reservados en ${monthName}.`}
                {preview.gap ? ` ${preview.gap}` : ''}
              </p>
            </div>
          ) : (
            <p aria-hidden className="mt-1.5 text-xs text-muted-foreground">
              Cargá lo gastado para ver el cierre.
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-1.5">
          <Label htmlFor={fieldId('notes')} className="gap-1 text-xs">
            Nota
            <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            ref={register('notes')}
            id={fieldId('notes')}
            rows={2}
            maxLength={280}
            placeholder="Ej.: reels de cumpleaños + historia fija"
            value={draft.notes}
            disabled={pending}
            aria-invalid={notesError ? true : undefined}
            aria-describedby={notesError ? `${fieldId('notes')}-error` : undefined}
            onChange={(e) => setField('notes', e.target.value)}
            onBlur={() => markTouched('notes')}
            onFocus={scrollIntoViewOnTouch}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
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

        <div className="mt-5 flex flex-col gap-2 @sm:flex-row @sm:items-center @sm:justify-end">
          {row ? (
            <Button
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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la pauta de cumpleaños de {monthName}?</AlertDialogTitle>
            <AlertDialogDescription>
              El mes vuelve a quedar «Sin cargar». Los cumpleaños y las personas no cambian.
            </AlertDialogDescription>
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
