'use client'

import { ChevronRight, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { PaperChoices } from '@/components/administracion/acciones/gasto-piezas'
import { Pill } from '@/components/administracion/kit'
import { vatRateLabel } from '@/lib/accounting/queries/labels'
import { cn } from '@/lib/utils'
import { isInvoiceVoucher, quickVoucherFromType } from '../../../_lib/quick-expense'
import {
  COMMON_VAT_RATES,
  OTHER_PAPER_OPTIONS,
  OTHER_VAT_RATES,
  paperShowsVat,
  voucherTypeForPaper,
} from '../_lib/form-payload'

/**
 * «¿Qué papel te dan?» de un gasto fijo: las MISMAS cuatro tarjetas de «Nuevo
 * gasto» (Factura A · Factura B o C · Tique · Remito o nada) más «No sé o
 * cambia», en lugar del desplegable de 13 tipos. Es el papel DE SIEMPRE: al
 * pagar se puede cambiar para ese pago.
 *
 * No hay ningún valor nuevo: cada tarjeta escribe el `voucherType` de siempre
 * (`voucherTypeForPaper`), «No sé o cambia» es `null`, y lo que no tiene
 * tarjeta (Factura M, tique factura, recibos, otro comprobante) sigue estando
 * detrás de «Otro papel». Los 13 de antes más el vacío siguen alcanzables.
 *
 * Debajo de la Factura A va «IVA de siempre» (es la única que lo discrimina);
 * con cualquier otro papel, ese dato queda en «Más opciones»: nunca en dos
 * lugares a la vez.
 */

const SMALL_PILL = 'md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]'

/** Las píldoras de «IVA de siempre». Las tres comunes, «No sé» y, detrás de «Otra», el resto. */
export function VatRatePills({
  value,
  onChange,
  labelledBy,
}: {
  value: number | null
  onChange: (rate: number | null) => void
  labelledBy: string
}) {
  const isOther = value !== null && (OTHER_VAT_RATES as readonly number[]).includes(value)
  const [more, setMore] = useState(isOther)
  return (
    // biome-ignore lint/a11y/useSemanticElements: grupo de píldoras que se aprietan, no un fieldset con su marco
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {COMMON_VAT_RATES.map((rate) => (
        <Pill
          key={rate}
          size="touch"
          activeTone="brand"
          active={value === rate}
          onClick={() => onChange(rate)}
          className={SMALL_PILL}
        >
          {vatRateLabel(rate)}
        </Pill>
      ))}
      <Pill
        size="touch"
        activeTone="brand"
        active={value === null}
        onClick={() => onChange(null)}
        className={SMALL_PILL}
      >
        No sé
      </Pill>
      {more ? (
        OTHER_VAT_RATES.map((rate) => (
          <Pill
            key={rate}
            size="touch"
            activeTone="brand"
            active={value === rate}
            onClick={() => onChange(rate)}
            className={SMALL_PILL}
          >
            {vatRateLabel(rate)}
          </Pill>
        ))
      ) : (
        <Pill size="touch" onClick={() => setMore(true)} className={SMALL_PILL}>
          Otra
        </Pill>
      )}
    </div>
  )
}

export function PaperField({
  idPrefix,
  voucherType,
  onVoucherTypeChange,
  vatRateBp,
  onVatRateChange,
  hasParty,
  error,
}: {
  idPrefix: string
  voucherType: string | null
  onVoucherTypeChange: (voucherType: string | null) => void
  vatRateBp: number | null
  onVatRateChange: (rate: number | null) => void
  /** Sin proveedor, una factura no se puede cargar: se avisa (no bloquea). */
  hasParty: boolean
  error?: string
}) {
  const paper = quickVoucherFromType(voucherType)
  const isOther = voucherType !== null && paper === null
  const [otherOpen, setOtherOpen] = useState(isOther)
  const questionId = `${idPrefix}-papel`
  const vatId = `${idPrefix}-iva-papel`
  const needsParty = paper !== null && isInvoiceVoucher(paper) && !hasParty

  return (
    <div className="grid gap-3">
      <span id={questionId} className="text-sm font-medium">
        ¿Qué papel te dan?
      </span>
      <PaperChoices
        name={`${idPrefix}-papel`}
        labelledBy={questionId}
        value={paper}
        onPick={(next) => onVoucherTypeChange(voucherTypeForPaper(next, voucherType))}
        consequenceFor={(option) => option.consequence}
      />

      {paper === 'bc' ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-secondary/50 p-3">
          <span id={`${idPrefix}-letra`} className="text-sm">
            ¿Cuál de las dos?
          </span>
          {/* biome-ignore lint/a11y/useSemanticElements: dos píldoras que se aprietan */}
          <div role="group" aria-labelledby={`${idPrefix}-letra`} className="flex gap-2">
            <Pill
              size="touch"
              activeTone="brand"
              active={voucherType === 'factura_c'}
              onClick={() => onVoucherTypeChange('factura_c')}
              className={SMALL_PILL}
            >
              C
            </Pill>
            <Pill
              size="touch"
              activeTone="brand"
              active={voucherType === 'factura_b'}
              onClick={() => onVoucherTypeChange('factura_b')}
              className={SMALL_PILL}
            >
              B
            </Pill>
          </div>
        </div>
      ) : null}

      {paperShowsVat(voucherType) ? (
        <div className="grid gap-2 rounded-xl bg-secondary/50 p-3">
          <span id={vatId} className="text-sm">
            IVA de siempre
          </span>
          <VatRatePills value={vatRateBp} onChange={onVatRateChange} labelledBy={vatId} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Pill
          size="touch"
          activeTone="brand"
          active={voucherType === null}
          onClick={() => onVoucherTypeChange(null)}
          className={SMALL_PILL}
        >
          No sé o cambia
        </Pill>
        {voucherType === null ? (
          <p className="min-w-0 flex-1 basis-48 text-xs text-muted-foreground text-pretty">
            Al pagar te lo pregunto. Arranca en «Remito o nada».
          </p>
        ) : null}
      </div>

      <div>
        <button
          type="button"
          aria-expanded={otherOpen}
          aria-controls={`${idPrefix}-otro-papel`}
          onClick={() => setOtherOpen((value) => !value)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-4 transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
              otherOpen && 'rotate-90',
            )}
          />
          Otro papel
        </button>
        {otherOpen ? (
          // biome-ignore lint/a11y/useSemanticElements: grupo de píldoras que se aprietan
          <div
            id={`${idPrefix}-otro-papel`}
            role="group"
            aria-label="Otro papel"
            className="mt-2 flex flex-wrap gap-2"
          >
            {OTHER_PAPER_OPTIONS.map((option) => (
              <Pill
                key={option.value}
                size="touch"
                activeTone="brand"
                active={voucherType === option.value}
                onClick={() => onVoucherTypeChange(option.value)}
                className={SMALL_PILL}
              >
                {option.label}
              </Pill>
            ))}
          </div>
        ) : null}
      </div>

      {needsParty ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/8 p-3 text-sm text-pretty">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
          Una factura pide proveedor. Sin él, al pagar va a arrancar en «Remito o nada».
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
