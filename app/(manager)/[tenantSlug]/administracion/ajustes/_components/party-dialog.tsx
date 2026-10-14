'use client'

import { ChevronRight } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { Label } from '@/components/ui/label'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { saveParty } from '@/lib/accounting/actions/master'
import type { CommissionVatMode, PartyRates } from '@/lib/accounting/types'
import { chargeBreakdown, joinWords } from '../_lib/cobros'
import { COMMISSION_VAT_MODE_LABELS } from '../_lib/labels'
import {
  CHARGING_PARTY_KINDS,
  type PartyDraft,
  partyDraftOf,
  partyDraftRates,
  partyRateKeys,
  partySavePayload,
  type RateKey,
  type SystemPartyRow,
} from '../_lib/payloads'
import { ChargeSplit } from './charge-split'
import { EditDialog } from './edit-dialog'
import { describedBy, Field, OptionalMark } from './form-bits'
import { CuitInput, PercentInput, SwitchRow } from './inputs'
import { useMasterAction } from './use-master-action'

/**
 * «Lo que te descuentan»: la comisión, las retenciones, cómo factura la
 * comisión y la CUIT de quien cobra por el bar (una tarjeta, una app, la
 * billetera, un banco). De los organismos solo se carga la CUIT.
 *
 * Es el formulario de siempre (`partySavePayload`, fijado por un test). Antes
 * vivía en la pestaña «Plataformas», lejos del medio al que le pega; ahora se
 * abre desde la píldora de comisión de cada medio y desde la lista de CUIT.
 * Arriba, el dibujo en vivo: «De cada $ 10.000», que se mueve mientras se
 * escribe el porcentaje.
 */

export type PartyDialogTarget = {
  party: SystemPartyRow
  /** Los medios prendidos que usan a este partícipe: «Vale para: Transferencia y QR». */
  methods?: readonly string[]
}

const RATE_LABEL: Readonly<Record<Exclude<RateKey, 'commissionBp' | 'sircupaBp'>, string>> = {
  iibbWithholdingBp: 'Ingresos Brutos',
  vatWithholdingBp: 'IVA',
  incomeTaxWithholdingBp: 'Ganancias',
}

const VAT_MODE_OPTIONS: readonly ChoiceChip<CommissionVatMode>[] = (
  Object.keys(COMMISSION_VAT_MODE_LABELS) as CommissionVatMode[]
).map((value) => ({ value, label: COMMISSION_VAT_MODE_LABELS[value] }))

const EMPTY_RATES: PartyRates = {
  commissionBp: null,
  iibbWithholdingBp: null,
  vatWithholdingBp: null,
  incomeTaxWithholdingBp: null,
  sircupaBp: null,
}

export function PartyDialog({
  tenantSlug,
  target,
  onClose,
}: {
  tenantSlug: string
  /** `null` = cerrado. */
  target: PartyDialogTarget | null
  onClose: () => void
}) {
  const { pending, run } = useMasterAction()
  const [seen, setSeen] = useState<PartyDialogTarget | null>(null)
  const [draft, setDraft] = useState<PartyDraft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [withholdingsOpen, setWithholdingsOpen] = useState(false)

  if (target !== seen) {
    setSeen(target)
    if (target) {
      const next = partyDraftOf(target.party)
      setDraft(next)
      setErrors({})
      setMessage(null)
      // Abiertas si ya hay alguna cargada: lo que tiene dato no se esconde.
      setWithholdingsOpen(
        partyRateKeys(target.party.kind).some(
          (key) => key !== 'commissionBp' && next.rates[key] !== '',
        ),
      )
    }
  }

  const onFailure = (state: AccFailureState) => {
    const fields = { ...(state.fieldErrors ?? {}) }
    if (fields.taxIdType && !fields.taxId) fields.taxId = fields.taxIdType
    setErrors(fields)
    setMessage(Object.keys(fields).length > 0 ? null : state.message)
    if (Object.keys(fields).some((f) => f in RATE_LABEL || f === 'sircupaBp')) {
      setWithholdingsOpen(true)
    }
  }

  const save = () => {
    if (!draft) return
    const result = partySavePayload(draft)
    if (!result.ok) {
      setErrors(result.errors)
      if (Object.keys(result.errors).some((f) => f in RATE_LABEL || f === 'sircupaBp')) {
        setWithholdingsOpen(true)
      }
      return
    }
    run(() => saveParty(tenantSlug, result.payload), { onSuccess: onClose, onFailure })
  }

  const err = (k: string) => errors[k] ?? null
  const set = (patch: Partial<PartyDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const setRate = (key: RateKey, text: string) =>
    setDraft((d) => (d ? { ...d, rates: { ...d.rates, [key]: text } } : d))

  const party = draft?.party ?? null
  const charges = party ? CHARGING_PARTY_KINDS.has(party.kind) : false
  const keys = party ? partyRateKeys(party.kind) : []
  // Lo que se está escribiendo, leído: un porcentaje que no se entiende cuenta como vacío.
  const live: PartyRates = draft ? { ...EMPTY_RATES, ...partyDraftRates(draft).rates } : EMPTY_RATES
  const methods = target?.methods ?? []

  const rateField = (
    key: RateKey,
    label: ReactNode,
    opts: { hint?: string; wide?: boolean } = {},
  ) =>
    draft ? (
      <Field
        key={key}
        id={`sp-${key}`}
        // Un rótulo largo va entero en un solo bloque (con su «(opcional)» adentro): suelto en la
        // etiqueta, que es una fila, se parte en una columna de una palabra por renglón.
        label={
          opts.wide ? (
            <span className="leading-snug text-pretty">
              {label} <OptionalMark />
            </span>
          ) : (
            label
          )
        }
        optional={!opts.wide}
        hint={opts.hint}
        error={err(key)}
        className={opts.wide ? 'sm:col-span-2' : undefined}
      >
        <PercentInput
          id={`sp-${key}`}
          value={draft.rates[key]}
          invalid={Boolean(err(key))}
          describedBy={describedBy(`sp-${key}`, opts.hint, err(key))}
          onChange={(text) => setRate(key, text)}
          // A todo el ancho del renglón, pero el casillero mide lo mismo que los de arriba.
          className={opts.wide ? 'sm:w-[calc(50%-0.375rem)]' : undefined}
        />
      </Field>
    ) : null

  return (
    <EditDialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={party?.name ?? ''}
      description={
        charges
          ? 'Las tasas sirven para precargar los cobros; nunca se registran solas.'
          : 'De los organismos solo se carga la CUIT: la piden los libros de IVA.'
      }
      pending={pending}
      message={message}
      onSubmit={save}
    >
      {draft && party ? (
        <>
          {methods.length > 1 ? (
            <p className="-mt-1 text-sm text-muted-foreground text-pretty">
              Vale para: <span className="text-foreground">{joinWords(methods)}</span>.
            </p>
          ) : null}

          {party.kind === 'delivery_platform' ? (
            <SwitchRow
              id="sp-active"
              label="Trabajamos con esta app"
              description="Para cobrar con ella, su medio también tiene que estar prendido."
              checked={draft.active}
              onCheckedChange={(active) => set({ active })}
            />
          ) : null}

          {charges ? (
            <>
              <ChargeSplit breakdown={chargeBreakdown(live)} />

              {rateField('commissionBp', 'Comisión')}

              {keys.length > 1 ? (
                <details
                  open={withholdingsOpen}
                  onToggle={(e) => setWithholdingsOpen(e.currentTarget.open)}
                  className="group/ret rounded-xl bg-secondary/50"
                >
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-xl px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      aria-hidden
                      className="size-4 text-muted-foreground transition-transform group-open/ret:rotate-90 motion-reduce:transition-none"
                    />
                    Retenciones
                    <span className="font-normal text-muted-foreground">
                      (figuran en la liquidación)
                    </span>
                  </summary>
                  <div className="grid gap-3 px-3 pb-3 sm:grid-cols-2">
                    {keys.map((key) =>
                      key === 'commissionBp'
                        ? null
                        : key === 'sircupaBp'
                          ? rateField(key, 'Ingresos Brutos que retiene la billetera', {
                              wide: true,
                              hint: 'En la liquidación figura como SIRCUPA.',
                            })
                          : rateField(key, RATE_LABEL[key]),
                    )}
                  </div>
                </details>
              ) : null}

              <p className="text-xs text-muted-foreground text-pretty">
                Cada porcentaje se calcula sobre lo cobrado (la venta), no sobre la comisión. El IVA
                de la comisión (21&nbsp;%) lo calcula el sistema: no va en la retención de IVA.
                {party.kind === 'payment_wallet'
                  ? ' Si la comisión del QR cambia según cómo te pagan (dinero en cuenta, débito o crédito), poné la más común: la de cada cobro sale del reporte de Mercado Pago.'
                  : null}
              </p>

              <div className="grid gap-1.5">
                <Label id="sp-vat-mode-label">¿Cómo te factura la comisión?</Label>
                <ChoiceChips
                  options={VAT_MODE_OPTIONS}
                  value={draft.vatMode}
                  labelledBy="sp-vat-mode-label"
                  onChange={(vatMode) => set({ vatMode })}
                />
              </div>
            </>
          ) : null}

          <Field
            id="sp-cuit"
            label="CUIT"
            optional
            hint={charges ? 'La piden los libros de IVA.' : undefined}
            error={err('taxId')}
          >
            <CuitInput
              id="sp-cuit"
              value={draft.cuit}
              invalid={Boolean(err('taxId'))}
              describedBy={describedBy('sp-cuit', charges, err('taxId'))}
              onChange={(cuit) => set({ cuit })}
              onBlurCheck={(issue) =>
                setErrors((prev) => {
                  const { taxId: _taxId, ...rest } = prev
                  return issue ? { ...rest, taxId: issue } : rest
                })
              }
            />
          </Field>
        </>
      ) : null}
    </EditDialog>
  )
}
